import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { supabaseAdmin } from './supabaseClient.js';

import authRouter from './auth.js';

dotenv.config({ path: '../.env' });

// --- Pinata IPFS Upload ---
// (omitted for brevity in replacement preview)
async function uploadToIPFS(fileBuffer, fileName, mimeType) {
    const url = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, fileName);

    const metadata = JSON.stringify({ name: `GeoCorp-${fileName}` });
    formData.append('pinataMetadata', metadata);

    const options = JSON.stringify({ cidVersion: 1 });
    formData.append('pinataOptions', options);

    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` },
        body: formData,
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Pinata upload failed (${res.status}): ${errText}`);
    }

    const data = await res.json();
    console.log(`📦 IPFS Upload OK! CID: ${data.IpfsHash}`);
    return data.IpfsHash; // This is the CID
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'geocorp-super-secret-key-123';

// --- Auth Middleware ---
const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const token = authHeader.split(' ')[1];
    
    // Hackathon dev bypass 
    if (token.startsWith('dev-token-')) {
        req.user = { id: '00000000-0000-0000-0000-000000000000', evm_address: '0x0000000000000000000000000000000000000001' };
        return next();
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};

function getAdminEmails() {
    return String(process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || process.env.FOUNDER_EMAIL || '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
}

const requireAdmin = (req, res, next) => {
    requireAuth(req, res, () => {
        const adminEmails = getAdminEmails();
        if (!adminEmails.length) {
            return res.status(403).json({
                error: 'Admin dashboard is not configured. Set ADMIN_EMAILS in Railway.',
            });
        }

        const email = String(req.user?.email || '').toLowerCase();
        if (!email || !adminEmails.includes(email)) {
            return res.status(403).json({ error: 'Forbidden: admin access required' });
        }
        next();
    });
};

function isSchemaCacheError(error) {
    return /schema cache|column|Could not find/i.test(error?.message || '');
}

function roundNumber(value, digits = 1) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const factor = 10 ** digits;
    return Math.round(number * factor) / factor;
}

function shortWallet(address) {
    if (!address) return null;
    const value = String(address);
    return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

async function fetchAdminReadings(limit = 500) {
    const maxLimit = Math.min(Math.max(Number(limit) || 500, 1), 2000);
    let { data, error } = await supabaseAdmin
        .from('signal_readings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(maxLimit);
    if (error) throw error;
    const rows = data || [];

    const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
    let profilesById = new Map();
    if (userIds.length) {
        const { data: profiles, error: profilesError } = await supabaseAdmin
            .from('profiles')
            .select('id, email, username, evm_address')
            .in('id', userIds);
        if (!profilesError) {
            profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]));
        } else if (!isSchemaCacheError(profilesError)) {
            console.warn(`Admin profile enrichment skipped: ${profilesError.message}`);
        }
    }

    return rows.map((row) => {
        const profile = profilesById.get(row.user_id) || {};
        return {
            ...row,
            mapper_email: profile.email || null,
            mapper_username: profile.username || null,
            mapper_wallet: profile.evm_address || null,
            mapper_wallet_short: shortWallet(profile.evm_address),
        };
    });
}

function buildCoverageSummary(rows) {
    const speedSamples = rows.map((row) => Number(row.speed_down)).filter(Number.isFinite);
    const uploadSamples = rows.map((row) => Number(row.speed_up)).filter(Number.isFinite);
    const latencySamples = rows.map((row) => Number(row.latency_ms)).filter(Number.isFinite);
    const operators = [...new Set(rows.map((row) => row.network_operator || row.carrier || row.sim_operator).filter(Boolean))];
    const userIds = new Set(rows.map((row) => row.user_id).filter(Boolean));
    const mobileRows = rows.filter((row) => !row.wifi_ssid && Number(row.wifi_count || 0) === 0);
    const wifiRows = rows.filter((row) => row.wifi_ssid || Number(row.wifi_count || 0) > 0);
    const lastReadingAt = rows[0]?.created_at || null;

    return {
        samples: rows.length,
        confirmed: rows.filter((row) => row.status === 'confirmed').length,
        pending: rows.filter((row) => row.status === 'pending').length,
        failed: rows.filter((row) => row.status === 'failed').length,
        rewardsPaid: rows.filter((row) => row.reward_status === 'paid').length,
        rewardsPending: rows.filter((row) => row.reward_status === 'pending').length,
        rewardsFailed: rows.filter((row) => row.reward_status === 'failed').length,
        activeMappers: userIds.size,
        avgDownload: speedSamples.length ? roundNumber(speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length, 1) : null,
        avgUpload: uploadSamples.length ? roundNumber(uploadSamples.reduce((a, b) => a + b, 0) / uploadSamples.length, 1) : null,
        avgLatency: latencySamples.length ? Math.round(latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length) : null,
        operators,
        wifiSamples: wifiRows.length,
        mobileSamples: mobileRows.length,
        lastReadingAt,
        freshnessMinutes: lastReadingAt ? Math.round((Date.now() - new Date(lastReadingAt).getTime()) / 60000) : null,
    };
}

// --- OpenRouter AI Setup ---
const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
        "HTTP-Referer": "https://geocorp.app",
        "X-Title": "GeoCorp",
    }
});

// --- Flow EVM Smart Contract Setup ---
const FLOW_RPC = "https://testnet.evm.nodes.onflow.org";
const CONTRACT_ADDRESS = "0x616e6907FBAd7CDCC18075b67B4119119B478FEf";

// New challenge contracts (from .env)
const TRUST_RECEIPTS_ADDRESS = process.env.TRUST_RECEIPTS_ADDRESS || "";
const CHALLENGE_MANAGER_ADDRESS = process.env.CHALLENGE_MANAGER_ADDRESS || "";

const TRUST_RECEIPTS_ABI = [
    "function mintTrustReceipt(address subject,uint8 agentType,string modelVersion,string verificationType,uint256 confidenceScore,int256 lat,int256 lng,string geohash,uint256 challengeId,uint256 tokenId,string proofCid) returns (uint256)",
    "event TrustReceiptMinted(uint256 indexed receiptId,address indexed subject,uint8 agentType,uint256 confidenceScore)"
];

const CHALLENGE_MANAGER_ABI = [
    "function nextChallengeId() view returns (uint256)",
    "function getChallenge(uint256 challengeId) view returns (tuple(uint256 id,address creator,string name,int256 lat,int256 lng,uint256 bountyPerCompletion,uint256 maxCompletions,uint256 completions,uint256 deadline,uint8 status,uint256 locationRadiusMeters,uint256 totalEscrow))",
    "function getCompletions(uint256 challengeId) view returns (tuple(address user,uint256 tokenId,uint256 trustReceiptId,uint256 timestamp,uint256 payout)[])",
    "function getChallengeStats(uint256 challengeId) view returns (uint256 completions,uint256 remaining,uint256 escrow,uint8 status)",
    "function hasUserCompleted(uint256 challengeId,address user) view returns (bool)",
    "function createChallenge(string name,int256 lat,int256 lng,uint256 bountyPerCompletion,uint256 maxCompletions,uint256 durationDays,uint256 radiusMeters,string placeId) payable returns (uint256)",
    "function completeChallenge(uint256 challengeId,address user,uint256 tokenId,uint256 trustReceiptId)",
    "function cancelChallenge(uint256 challengeId)",
    "event ChallengeCreated(uint256 indexed challengeId,address indexed creator,string name,uint256 totalEscrow)"
];

function loadAbi(name, fallbackAbi = null) {
    const artifactPath = join(__dirname, '..', 'artifacts', `${name}.json`);
    if (!existsSync(artifactPath)) return fallbackAbi;
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    return artifact.abi || fallbackAbi;
}

let contract = null;
let trustReceiptsContract = null;
let challengeManagerContract = null;
let wallet = null;
let provider = new ethers.JsonRpcProvider(FLOW_RPC);
let signalProcessingQueue = Promise.resolve();

function enqueueSignalProcessing(readingId, task) {
    signalProcessingQueue = signalProcessingQueue
        .catch((err) => {
            console.error('Signal processing queue recovered after error:', err?.message || err);
        })
        .then(async () => {
            console.log(`[reading:${readingId}] chain processing started`);
            await task();
        });
    signalProcessingQueue.catch((err) => {
        console.error(`[reading:${readingId}] chain processing queue error:`, err?.message || err);
    });
}

async function sendSignalReward({ readingId, to, amountEth }) {
    if (!wallet) return { status: 'skipped', txHash: null, error: 'deployer_wallet_unavailable' };
    if (!to || !ethers.isAddress(to)) return { status: 'skipped', txHash: null, error: 'no_profile_wallet' };

    const value = ethers.parseEther(String(amountEth));
    try {
        const rewardTx = await wallet.sendTransaction({ to, value });
        const rewardReceipt = await rewardTx.wait();
        if (rewardReceipt?.status === 1) {
            return { status: 'paid', txHash: rewardReceipt.hash, error: null };
        }
        return { status: 'failed', txHash: rewardReceipt?.hash || rewardTx.hash, error: 'reward_receipt_failed' };
    } catch (err) {
        const replacement = err?.replacement;
        const receipt = err?.receipt;
        const replacementMatches = replacement
            && replacement.to?.toLowerCase?.() === to.toLowerCase()
            && BigInt(replacement.value || 0) === value;
        if (err?.code === 'TRANSACTION_REPLACED' && replacementMatches && receipt?.status === 1) {
            return { status: 'paid', txHash: receipt.hash || replacement.hash, error: null };
        }
        return {
            status: 'failed',
            txHash: receipt?.hash || replacement?.hash || null,
            error: err?.shortMessage || err?.reason || err?.message || 'reward_payout_failed',
        };
    }
}

if (process.env.DEPLOYER_PRIVATE_KEY) {
    wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
    console.log(`Flow wallet ready. GeoCorp address: ${CONTRACT_ADDRESS}`);
    console.log(`📋 Oracle/Deployer: ${wallet.address}`);

    // Load TrustReceipts contract
    if (TRUST_RECEIPTS_ADDRESS) {
        try {
            const trustAbi = loadAbi('TrustReceipts', TRUST_RECEIPTS_ABI);
            trustReceiptsContract = new ethers.Contract(TRUST_RECEIPTS_ADDRESS, trustAbi, wallet);
            console.log(`🏷️  TrustReceipts contract loaded: ${TRUST_RECEIPTS_ADDRESS}`);
        } catch (e) {
            console.warn("⚠️  Could not load TrustReceipts contract:", e.message);
        }
    }

    // Load ChallengeManager contract
    if (CHALLENGE_MANAGER_ADDRESS) {
        try {
            const challengeAbi = loadAbi('ChallengeManager', CHALLENGE_MANAGER_ABI);
            challengeManagerContract = new ethers.Contract(CHALLENGE_MANAGER_ADDRESS, challengeAbi, wallet);
            console.log(`🎯 ChallengeManager contract loaded: ${CHALLENGE_MANAGER_ADDRESS}`);
        } catch (e) {
            console.warn("⚠️  Could not load ChallengeManager contract:", e.message);
        }
    }
} else {
    console.warn("Missing DEPLOYER_PRIVATE_KEY. Blockchain features disabled.");
}

const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRouter);

// ============================
// SignalMap Core Endpoints
// ============================

app.get('/api/speed/ping', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, ts: Date.now() });
});

app.get('/api/speed/download', (req, res) => {
    const requested = Number(req.query.bytes || 200000);
    const bytes = Math.max(1024, Math.min(Number.isFinite(requested) ? requested : 200000, 500000));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(Buffer.alloc(bytes, 7));
});

app.post('/api/speed/upload', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, bytes: req.body?.length || 0, ts: Date.now() });
});

app.get('/api/public-config', (req, res) => {
    const mapboxToken = [
        process.env.MAPBOX_PUBLIC_TOKEN,
        process.env.MAPBOX_TOKEN,
        process.env.MAPBOX_API_TOKEN,
        process.env.EXPO_PUBLIC_MAPBOX_TOKEN,
        process.env.REACT_APP_MAPBOX_TOKEN,
        process.env.VITE_MAPBOX_TOKEN,
    ].map((value) => String(value || '').trim()).find((value) => value.startsWith('pk.')) || '';
    res.json({
        mapboxToken: mapboxToken || null,
    });
});

// Serve static Founder Dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});
app.use('/dashboard', express.static(join(__dirname, 'public')));

app.get('/api/admin/overview', requireAdmin, async (req, res) => {
    try {
        const rows = await fetchAdminReadings(2000);
        res.json({ success: true, summary: buildCoverageSummary(rows) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/readings', requireAdmin, async (req, res) => {
    try {
        const rows = await fetchAdminReadings(req.query.limit || 250);
        res.json({ success: true, count: rows.length, data: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const rows = await fetchAdminReadings(2000);
        const users = new Map();
        for (const row of rows) {
            const key = row.user_id || 'unknown';
            if (!users.has(key)) {
                users.set(key, {
                    id: key,
                    email: row.mapper_email || null,
                    username: row.mapper_username || null,
                    wallet: row.mapper_wallet || null,
                    walletShort: row.mapper_wallet_short || null,
                    readings: 0,
                    confirmed: 0,
                    pending: 0,
                    failed: 0,
                    earnedFlow: 0,
                    rewardsPaid: 0,
                    lastSeenAt: null,
                    lastLat: null,
                    lastLng: null,
                    operators: new Set(),
                    transports: new Set(),
                });
            }
            const user = users.get(key);
            user.readings++;
            if (row.status === 'confirmed') user.confirmed++;
            if (row.status === 'pending') user.pending++;
            if (row.status === 'failed') user.failed++;
            if (row.reward_status === 'paid') user.rewardsPaid++;
            user.earnedFlow += Number(row.bounty_paid || 0);
            if (!user.lastSeenAt || new Date(row.created_at) > new Date(user.lastSeenAt)) {
                user.lastSeenAt = row.created_at;
                user.lastLat = row.lat;
                user.lastLng = row.lng;
            }
            const operator = row.network_operator || row.carrier || row.sim_operator;
            if (operator) user.operators.add(operator);
            if (row.network_type || row.technology) user.transports.add(row.network_type || row.technology);
        }

        const data = [...users.values()].map((user) => ({
            ...user,
            earnedFlow: roundNumber(user.earnedFlow, 4),
            operators: [...user.operators],
            transports: [...user.transports],
        })).sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0));

        res.json({ success: true, count: data.length, data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// New endpoint specifically for the dashboard to pull raw data
app.get('/api/admin/raw-data', requireAdmin, async (req, res) => {
    try {
        const rows = await fetchAdminReadings(500);
        const summary = buildCoverageSummary(rows);
        res.json({ success: true, count: rows.length, summary, data: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/readings/mock', requireAuth, async (req, res) => {
    try {
        const { lat, lng, carrier, technology, signalDbm, wifiCount } = req.body;
        const bounty = 0.001; 
        
        // 1. Save RAW telecom data to the Data Lake (for B2B sales)
        await supabaseAdmin.from('signal_readings').insert([{
            mapper_id: req.user.id,
            lat,
            lng,
            carrier,
            technology,
            signal_dbm: signalDbm,
            wifi_count: wifiCount || 0
        }]);

        // 2. Log Agent Activity to blockchain/agent_logs
        logAgentActivity('trust_receipt_minted', {
            status: 'success',
            agentId: 'mapper-oracle',
            confidenceScore: 9850,
            txHash: '0x' + Math.random().toString(16).slice(2, 10).padEnd(64, '0')
        });

        res.json({
            success: true,
            bounty,
            reading: { lat, lng, carrier, technology, signalDbm },
            trustReceipt: { id: Date.now(), txHash: '0xmock' }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/mapper/stats/mock', requireAuth, async (req, res) => {
    res.json({
        readings: Math.floor(Math.random() * 50),
        signalBalance: 0.05,
        flowBalance: '5.0',
        evmAddress: req.user.evm_address || '0x0000000000000000000000000000000000000001'
    });
});

// ============================
// AI Agent Activity Logging (Hackathon Storytelling Mode)
// ============================
const agentActivityLog = [];
const MAX_LOG_ENTRIES = 200;

// Human-readable stage labels for storytelling
const STAGE_LABELS = {
    challenge_fetch: '🔍 Scanning for active bounties...',
    image_received: '📸 Photo received from user',
    context_retrieval: '🌐 Fetching reference images from Google...',
    ai_decision: '🧠 Gemini analyzing visual match...',
    contract_signature: '✍️ Signing blockchain transaction...',
    nft_minted: '🏗️ Property NFT minted on-chain',
    trust_receipt_minted: '🏷️ Minting ERC-8004 Trust Receipt...',
    challenge_match: '🎯 Matching location to active challenge...',
    payout_executed: '💰 Challenge payout completed!',
    rejected: '❌ Photo rejected by AI Oracle',
    qr_issued: '📌 QR code issued for business',
    qr_verified: '✅ QR visit verified & bounty paid',
};

function logAgentActivity(stage, data) {
    const entry = {
        id: agentActivityLog.length + 1,
        stage,
        label: STAGE_LABELS[stage] || stage,
        timestamp: new Date().toISOString(),
        status: data?.status || 'pending',
        data: data || {},
    };
    agentActivityLog.push(entry);
    if (agentActivityLog.length > MAX_LOG_ENTRIES) {
        agentActivityLog.shift();
    }

    // Rich console log
    const icon = entry.label.split(' ')[0];
    const text = entry.label.substring(entry.label.indexOf(' ') + 1);
    console.log(`\n  ${icon} [Agent Step #${entry.id}] ${text}`);
    if (data.txHash) console.log(`     🔗 TX: ${data.txHash}`);
    if (data.trustReceiptId) console.log(`     🏷️  Trust Receipt #${data.trustReceiptId}`);
    if (data.challengeId) console.log(`     🎯 Challenge #${data.challengeId}`);
    if (data.confidenceScore) console.log(`     📊 Confidence: ${(data.confidenceScore / 100).toFixed(0)}%`);

    // Async write to Supabase (graceful fail if table doesn't exist)
    supabaseAdmin
        .from('agent_logs')
        .insert({
            log_id: entry.id,
            action_type: stage,
            stage,
            label: entry.label,
            status: entry.status,
            data: data ?? {},
            created_at: entry.timestamp,
        })
        .then(({ error }) => {
            if (error && !error.message?.includes('already present')) {
                console.log(`     ⚠️  Supabase log skipped: ${error.message}`);
            }
        })
        .catch(() => {});

    return entry;
}

// API: Get recent agent activity (for visualization dashboard)
app.get('/api/agent-activity', (req, res) => {
    const limit = parseInt(req.query.limit) || 30;
    const recent = agentActivityLog.slice(-limit).reverse();
    res.json({ activities: recent, total: agentActivityLog.length });
});

// API: Get agent stats (for dashboard summary)
app.get('/api/agent-stats', (req, res) => {
    const stats = {
        totalValidations: 0,
        approved: 0,
        rejected: 0,
        challengesCompleted: 0,
        trustReceiptsMinted: 0,
        totalPayouts: '0',
        avgConfidence: 0,
        pipeline: [], // Current in-progress items
    };

    let confidenceSum = 0;
    let confidenceCount = 0;

    for (const entry of agentActivityLog) {
        stats.totalValidations++;
        if (entry.stage === 'ai_decision' && entry.data?.approved) stats.approved++;
        if (entry.stage === 'rejected') stats.rejected++;
        if (entry.stage === 'challenge_match') stats.challengesCompleted++;
        if (entry.stage === 'trust_receipt_minted') stats.trustReceiptsMinted++;
        if (entry.data?.confidenceScore) {
            confidenceSum += entry.data.confidenceScore;
            confidenceCount++;
        }
    }

    stats.avgConfidence = confidenceCount > 0 ? Math.round(confidenceSum / confidenceCount / 100) : 0;

    // Build pipeline: group by recent sessions (grouped by user address)
    const users = new Map();
    const lastEntries = agentActivityLog.slice(-50);
    for (const entry of lastEntries) {
        const userId = entry.data?.user;
        if (!userId) continue;
        if (!users.has(userId)) users.set(userId, []);
        users.get(userId).push(entry);
    }

    for (const [userId, entries] of users.entries()) {
        const lastEntry = entries[entries.length - 1];
        stats.pipeline.push({
            user: userId,
            steps: entries.map(e => ({ stage: e.stage, status: e.status, timestamp: e.timestamp })),
            currentStatus: lastEntry.stage,
            completed: lastEntry.stage === 'payout_executed' || lastEntry.stage === 'rejected',
        });
    }

    res.json({ stats });
});

// POST /api/faucet — Send testnet FLOW to user's wallet
const faucetCooldowns = new Map();
app.post('/api/faucet', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const now = Date.now();
        const lastClaim = faucetCooldowns.get(userId) || 0;
        if (now - lastClaim < 3600000) {
            const waitMin = Math.ceil((3600000 - (now - lastClaim)) / 60000);
            return res.status(429).json({ error: `Wait ${waitMin} min before next claim` });
        }

        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('evm_address')
            .eq('id', userId)
            .single();

        if (!profile?.evm_address) {
            return res.status(400).json({ error: 'No wallet address found' });
        }

        if (!wallet) {
            return res.status(503).json({ error: 'Faucet unavailable (no deployer key)' });
        }

        const tx = await wallet.sendTransaction({
            to: profile.evm_address,
            value: ethers.parseEther('0.5'),
        });
        await tx.wait();

        faucetCooldowns.set(userId, now);
        console.log(`🚰 Faucet: sent 0.5 FLOW to ${profile.evm_address} (tx: ${tx.hash})`);

        res.json({
            success: true,
            amount: '0.5',
            txHash: tx.hash,
            flowscanUrl: `https://evm-testnet.flowscan.io/tx/${tx.hash}`,
        });
    } catch (err) {
        console.error('❌ Faucet error:', err.message);
        res.status(500).json({ error: 'Faucet transaction failed' });
    }
});

// Database Profile Info
// Building type reverse map (smart contract enum → category name)
const BUILDING_TYPE_NAMES = ['Café', 'Restaurant', 'Shop', 'Office', 'Gas Station', 'Park', 'Hotel', 'Mall', 'Gym', 'Other'];

// Helper: calculate balance + yield from Supabase businesses
async function _calcFromSupabase(userId, baseBalance) {
    const { data: supaBiz } = await supabaseAdmin
        .from('businesses')
        .select('*')
        .eq('user_id', userId);

    const { data: visitData } = await supabaseAdmin
        .from('visits')
        .select('*')
        .eq('user_id', userId);

    const businesses = supaBiz || [];
    const totalDailyYield = businesses.reduce((sum, b) => sum + (b.yield_rate || 0), 0);
    const propertiesOwned = businesses.length;
    const totalVisits = visitData ? visitData.length : 0;
    const totalBountyEarned = visitData ? visitData.reduce((sum, v) => sum + (v.bounty || 0), 0) : 0;

    const onChainBalance = baseBalance || 0;

    return { businesses, totalDailyYield, propertiesOwned, totalVisits, totalBountyEarned, onChainBalance };
}

app.get('/api/me', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Always get user profile from Supabase (auth, email, username, wallet)
        const { data: user, error: userErr } = await supabaseAdmin
            .from('profiles')
            .select('id, email, username, energy, evm_address, evm_private_key, geo_balance')
            .eq('id', userId)
            .single();

        if (userErr || !user) return res.status(404).json({ error: 'User not found' });

        // Try to read game data from Flow blockchain
        let businesses = [];
        let onChainBalance = user.geo_balance;
        let propertiesOwned = 0;
        let totalDailyYield = 0;
        let totalVisits = 0;
        let totalBountyEarned = 0;

        const { count: visitCount } = await supabaseAdmin
            .from('visits')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);

        const { data: visitAgg } = await supabaseAdmin
            .from('visits')
            .select('bounty')
            .eq('user_id', userId);

        totalVisits = visitCount || 0;
        totalBountyEarned = (visitAgg || []).reduce((s, v) => s + (v.bounty || 0), 0);
        onChainBalance = user.geo_balance || 0;

        res.json({
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                energy: user.energy,
                evm_address: user.evm_address,
                evm_private_key: user.evm_private_key,
                balance: onChainBalance
            },
            businesses,
            metrics: {
                totalVisits,
                totalBountyEarned: Math.round(totalBountyEarned * 100) / 100,
                propertiesOwned
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Leaderboard with real-time yield calculation
app.get('/api/leaderboard', async (req, res) => {
    try {
        const { data: profiles, error: profilesErr } = await supabaseAdmin
            .from('profiles')
            .select('id, username, evm_address, geo_balance, energy, created_at')
            .limit(100);

        if (profilesErr) throw profilesErr;

        const { data: visitData } = await supabaseAdmin
            .from('visits')
            .select('user_id, bounty');

        const visitsByUser = {};
        for (const v of (visitData || [])) {
            if (!visitsByUser[v.user_id]) visitsByUser[v.user_id] = { count: 0, totalBounty: 0 };
            visitsByUser[v.user_id].count++;
            visitsByUser[v.user_id].totalBounty += (v.bounty || 0);
        }

        const users = profiles.map(u => {
            const visitInfo = visitsByUser[u.id] || { count: 0, totalBounty: 0 };
            return {
                id: u.id,
                username: u.username,
                evm_address: u.evm_address,
                geo_balance: Number((u.geo_balance || 0).toFixed(2)),
                total_visits: visitInfo.count,
                total_bounty_earned: Number(visitInfo.totalBounty.toFixed(2)),
            };
        });

        users.sort((a, b) => b.total_visits - a.total_visits || b.total_bounty_earned - a.total_bounty_earned);
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Global claims for map visualization
app.get('/api/global-claims', (req, res) => res.json({}));
app.get('/api/check-ownership', (req, res) => res.json({ owned: false }));
app.post('/api/capture', (req, res) => res.status(410).json({ error: 'Capture deprecated. Use QR scan instead.' }));

app.get('/api/transactions', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('transactions')
            .select('*')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false })
            .limit(parseInt(req.query.limit) || 20);

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'GeoCorp backend is running!',
        blockchain: contract ? `Connected to ${CONTRACT_ADDRESS}` : 'Not connected',
        ipfs: process.env.PINATA_JWT ? 'Pinata connected' : 'Not configured',
    });
});

// --- Main Validation Endpoint (Auth-protected) ---
app.post('/api/validate', requireAuth, upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No photo provided' });
        }

        const mimeType = req.file.mimetype;
        const base64Image = req.file.buffer.toString('base64');
        const dataUrl = `data:${mimeType};base64,${base64Image}`;

        // Extract metadata from the request body
        const explorerAddress = req.body.explorerAddress;
        if (!explorerAddress || explorerAddress === '0x0000000000000000000000000000000000000001' || explorerAddress === '0x0000000000000000000000000000000000000000') {
            return res.status(400).json({ error: 'Valid wallet address required. Please restart the app.' });
        }
        const lat = req.body.lat ? Math.round(parseFloat(req.body.lat) * 1e6) : 0;
        const lng = req.body.lng ? Math.round(parseFloat(req.body.lng) * 1e6) : 0;
        const reward = req.body.reward ? parseInt(req.body.reward) : 25;

        const businessName = req.body.businessName || '';
        const businessCategory = req.body.businessCategory || '';
        const SERPER_API_KEY = process.env.SERPER_API_KEY || '';

        console.log(`\n🔍 Analyzing image for mission: "${businessName}" (${businessCategory})...`);

        // ── Log: Image Received ──
        logAgentActivity('image_received', {
            status: 'success',
            user: explorerAddress,
            businessName,
            businessCategory,
            lat: lat / 1e6,
            lng: lng / 1e6,
            imageSize: req.file ? req.file.size : 0,
        });

        // ── Step 1: Fetch reference image from Google Images via Serper ──
        let referenceImageUrl = null;
        let referenceDataUrl = null;

        // Log context retrieval start
        logAgentActivity('context_retrieval', {
            status: 'pending',
            query: `${businessName} ${businessCategory} storefront`,
        });

        // Get city name via Reverse Geocoding to improve Google Image search accuracy
        let cityName = "";
        try {
            if (req.body.lat && req.body.lng) {
                const geoLat = parseFloat(req.body.lat);
                const geoLng = parseFloat(req.body.lng);
                console.log(`🌍 Getting city name for coordinates: ${geoLat}, ${geoLng}...`);
                const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${geoLat}&lon=${geoLng}`, {
                    headers: { 'User-Agent': 'GeoCorp-Verification-Server/1.0' }
                });
                if (geoRes.ok) {
                    const geoData = await geoRes.json();
                    cityName = geoData.address?.city || geoData.address?.town || geoData.address?.village || "";
                    if (cityName) console.log(`📍 Found city: ${cityName}`);
                }
            }
        } catch (e) {
            console.log("⚠️ Reverse geocoding failed, proceeding without city name.");
        }

        try {
            const serperQuery = `${businessName} ${businessCategory} ${cityName} storefront exterior building`.trim();
            console.log(`🖼️  Serper: Searching reference image for "${serperQuery}"...`);

            const serperRes = await fetch('https://google.serper.dev/images', {
                method: 'POST',
                headers: {
                    'X-API-KEY': SERPER_API_KEY,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    q: serperQuery,
                    num: 5,
                }),
            });

            if (serperRes.ok) {
                const serperData = await serperRes.json();
                const images = serperData.images || [];

                // Try to download each image result until one succeeds
                for (const img of images) {
                    try {
                        const imgRes = await fetch(img.imageUrl, {
                            headers: { 'User-Agent': 'Mozilla/5.0' },
                            signal: AbortSignal.timeout(5000),
                        });
                        if (!imgRes.ok) continue;

                        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
                        if (!contentType.startsWith('image/')) continue;

                        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
                        if (imgBuffer.length < 1000) continue; // Skip tiny/broken images

                        referenceDataUrl = `data:${contentType};base64,${imgBuffer.toString('base64')}`;
                        referenceImageUrl = img.imageUrl;
                        console.log(`✅ Reference image downloaded (${(imgBuffer.length / 1024).toFixed(1)}KB): ${img.imageUrl.substring(0, 80)}...`);
                        break;
                    } catch (dlErr) {
                        console.log(`⚠️  Failed to download ${img.imageUrl.substring(0, 60)}...: ${dlErr.message}`);
                    }
                }

                if (!referenceDataUrl) {
                    console.log('⚠️  Could not download any reference images, falling back to single-image mode.');
                }
            } else {
                console.log(`⚠️  Serper API error (${serperRes.status}), falling back to single-image mode.`);
            }
        } catch (serperErr) {
            console.log('⚠️  Serper fetch failed:', serperErr.message, '— falling back to single-image mode.');
        }

        // ── Log: Context Retrieval Complete ──
        logAgentActivity('context_retrieval', {
            status: 'success',
            foundReference: !!referenceDataUrl,
            referenceUrl: referenceImageUrl || null,
        });

        // ── Step 2: Build the AI prompt (dual-image or single-image) ──
        let promptText;
        let messageContent;

        if (referenceDataUrl) {
            // ★ DUAL-IMAGE MODE: Compare user photo vs Google reference
            promptText = `You are an AI Oracle for GeoCorp, a location verification game.

You receive TWO images:
- IMAGE 1 (User Photo): Taken by a player claiming to be at "${businessName}" (Category: ${businessCategory}).
- IMAGE 2 (Google Reference): A reference photo of "${businessName}" from Google.

VERIFICATION RULES (IMPORTANT):
1. LOOK FOR ARCHITECTURE & CONTEXT: First, verify if IMAGE 1 shows a real physical environment (building, entrance, windows, street, sidewalk).
2. MATCHING STYLE: Compare IMAGE 1 architecture style (colors, materials, entrance layout, window patterns) with IMAGE 2.
3. LOGO & BRANDING: Look for the logo, brand colors, or signage of "${businessName}". It's okay if the text is partially visible or in a different language, as long as the brand is identifiable.
4. APPROVE if:
   - There is clear brand evidence (logo/sign) AND the building style matches IMAGE 2.
   - OR the branding name is not visible, but the building geometry, facade, and surroundings match IMAGE 2 perfectly.
   - The photo is taken from a screen/monitor (Desk Testing Mode) as long as it shows a real place on that screen.
5. REJECT if:
   - It is a "Text-only" cheat (e.g., "${businessName}" written on a piece of paper, a random wall, or a flat blank screen).
   - IMAGE 1 shows a completely different brand (e.g., McDonald's instead of ${businessName}).
   - The photo is of random scenery with NO business context.
   - It is a selfie or a photo of a person with no visible building context.

Respond ONLY: 'YES|TYPE' (TYPE = CAFE, RESTAURANT, SHOP, OFFICE, GAS, PARK, HOTEL, MALL, GYM, OTHER) or 'NO'.
Do not add any explanation. Keep it purely functional.`;

            messageContent = [
                { type: "text", text: promptText },
                { type: "image_url", image_url: { url: dataUrl } },
                { type: "image_url", image_url: { url: referenceDataUrl } },
            ];
            console.log('🔀 Mode: DUAL-IMAGE comparison (User Photo + Google Reference)');
        } else {
            // Fallback: single image mode
            promptText = `You are an AI Oracle for GeoCorp, a location verification game.

The player claims to be at "${businessName}" (Category: ${businessCategory}).

Look at the photo and determine if it shows "${businessName}".

APPROVE if:
- You see clear brand evidence (logo, signage, colors) of "${businessName}".
- The photo shows a physical storefront, building entrance, or business interior.
- Even if taken from a weird angle, through a screen, or at night.

REJECT if:
- It is a "Text-only" cheat (e.g., name written on a paper or flat blank surface).
- The photo shows a completely DIFFERENT business.
- There is NO physical business context (just random scenery or people).

Respond ONLY: 'YES|TYPE' (TYPE = CAFE, RESTAURANT, SHOP, OFFICE, GAS, PARK, HOTEL, MALL, GYM, or OTHER) or 'NO'.
Do not add any explanation. Purely functional.`;

            messageContent = [
                { type: "text", text: promptText },
                { type: "image_url", image_url: { url: dataUrl } },
            ];
            console.log('📷 Mode: SINGLE-IMAGE (no reference available)');
        }

        // ── Step 3: Call Gemini 3 Flash Preview via OpenRouter (with retry) ──
        const AI_MODEL = "google/gemini-3-flash-preview";
        let response;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                response = await openai.chat.completions.create({
                    model: AI_MODEL,
                    messages: [{ role: "user", content: messageContent }],
                    max_tokens: 20,
                });
                break; // Success, exit retry loop
            } catch (retryErr) {
                console.error(`⚠️ AI attempt ${attempt}/2 failed:`, retryErr.message);
                if (attempt === 2) throw retryErr; // Re-throw on final attempt
                await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
            }
        }

        const aiAnswer = response.choices[0]?.message?.content?.trim().toUpperCase();
        console.log("🤖 OpenRouter Answer:", aiAnswer);

        const isApproved = aiAnswer.includes('YES');

        // Parse confidence score from AI response
        const confidenceMatch = aiAnswer.match(/(\d+)/);
        const confidenceScore = confidenceMatch ? Math.min(parseInt(confidenceMatch[1]) * 100, 10000) : 9500;

        // ── Log: AI Decision ──
        logAgentActivity('ai_decision', {
            status: isApproved ? 'success' : 'rejected',
            approved: isApproved,
            aiResponse: aiAnswer,
            confidenceScore,
            model: AI_MODEL,
        });

        // Parse building type from AI response (e.g., "YES|CAFE")
        const buildingTypeMap = { CAFE: 0, RESTAURANT: 1, SHOP: 2, OFFICE: 3, GAS: 4, PARK: 5, HOTEL: 6, MALL: 7, GYM: 8, OTHER: 9 };
        let buildingType = 9; // Default: Other
        if (isApproved && aiAnswer.includes('|')) {
            const typePart = aiAnswer.split('|')[1]?.trim();
            if (typePart && buildingTypeMap[typePart] !== undefined) {
                buildingType = buildingTypeMap[typePart];
            }
        }

        // --- Blockchain: Record result on-chain ---
        let txHash = null;
        let flowscanUrl = null;
        let trustReceiptId = null;
        let trustReceiptTx = null;
        let challengePayoutTx = null;
        let challengeBounty = null;

        try {
        if (isApproved) {
            const mintedTokenId = 0;
            let ipfsCid = null;
            try {
                const fileName = `visit_${Date.now()}.jpg`;
                ipfsCid = await uploadToIPFS(req.file.buffer, fileName, mimeType);
            } catch (ipfsErr) {
                console.error('⚠️ IPFS upload failed:', ipfsErr.message);
            }

            if (trustReceiptsContract) {
                try {
                    const confidenceMatch = aiAnswer.match(/(\d+)/);
                    const confidenceScore = confidenceMatch ? Math.min(parseInt(confidenceMatch[1]) * 100, 10000) : 9500;
                    const geoHash = `${(lat / 1e6).toFixed(2)},${(lng / 1e6).toFixed(2)}`;

                    console.log(`🏷️  Minting TrustReceipt for user ${explorerAddress}...`);
                    const trustTx = await trustReceiptsContract.mintTrustReceipt(
                        explorerAddress,
                        0,
                        "gemini-vision-v1",
                        "google/gemini-3-flash-preview",
                        confidenceScore,
                        BigInt(lat),
                        BigInt(lng),
                        geoHash,
                        0,
                        BigInt(mintedTokenId),
                        ipfsCid || 'no-photo'
                    );
                    const trustReceipt = await trustTx.wait();
                    trustReceiptTx = trustReceipt.hash;

                    const receiptEvent = trustReceipt.logs?.find(l => {
                        try {
                            const parsed = trustReceiptsContract.interface.parseLog(l);
                            return parsed && parsed.name === 'TrustReceiptMinted';
                        } catch { return false; }
                    });
                    if (receiptEvent) {
                        trustReceiptId = Number(trustReceiptsContract.interface.parseLog(receiptEvent).args.receiptId);
                    }
                    console.log(`✅ TrustReceipt minted! ID: ${trustReceiptId}`);

                    logAgentActivity('trust_receipt_minted', {
                        status: 'success',
                        receiptId: trustReceiptId,
                        txHash: trustReceiptTx,
                        agentId: 'gemini-vision-v1',
                        confidenceScore,
                    });
                } catch (trustErr) {
                    console.error('⚠️ TrustReceipt mint failed:', trustErr.message);
                }
            }

                    // ── ChallengeManager: Match captured business to active challenge by name ──
                    if (challengeManagerContract) {
                        try {
                            const nextId = await challengeManagerContract.nextChallengeId();

                            for (let cid = 1; cid < nextId; cid++) {
                                try {
                                    const challenge = await challengeManagerContract.getChallenge(cid);
                                    const isActive = Number(challenge.status) === 0;
                                    const hasCompleted = await challengeManagerContract.hasUserCompleted(cid, explorerAddress);

                                    if (isActive && !hasCompleted) {
                                        const challengeName = challenge.name;
                                        const chalNameLower = challengeName.toLowerCase();
                                        const bizNameLower = businessName.toLowerCase();

                                        const nameMatch = bizNameLower === chalNameLower ||
                                            bizNameLower.includes(chalNameLower) ||
                                            chalNameLower.includes(bizNameLower) ||
                                            bizNameLower.split(/\s+/).some(w => w.length > 3 && chalNameLower.includes(w));

                                        if (!nameMatch) continue;

                                        const challengeLat = Number(challenge.lat) / 1e6;
                                        const challengeLng = Number(challenge.lng) / 1e6;
                                        const latDiff = Math.abs(Number(lat) / 1e6 - challengeLat);
                                        const lngDiff = Math.abs(Number(lng) / 1e6 - challengeLng);
                                        const distanceMeters = Math.sqrt(
                                            (latDiff * 111000) ** 2 +
                                            (lngDiff * 111000 * Math.cos(Number(lat) / 1e6 * Math.PI / 180)) ** 2
                                        );

                                        const maxDistance = Math.max(Number(challenge.locationRadiusMeters) || 50, 500);

                                        if (distanceMeters <= maxDistance) {
                                            console.log(`🎯 Challenge #${cid} matched by name! "${businessName}" ≈ "${challengeName}" (${distanceMeters.toFixed(0)}m apart)`);

                                            logAgentActivity('challenge_match', {
                                                status: 'pending',
                                                challengeId: cid,
                                                user: explorerAddress,
                                                matchMethod: 'name',
                                                capturedName: businessName,
                                                challengeName,
                                                distance: distanceMeters,
                                            });

                                            const completeTx = await challengeManagerContract.completeChallenge(
                                                cid,
                                                explorerAddress,
                                                BigInt(mintedTokenId),
                                                BigInt(trustReceiptId || 0)
                                            );
                                            const completeReceipt = await completeTx.wait();
                                            challengePayoutTx = completeReceipt.hash;
                                            challengeBounty = ethers.formatEther(challenge.bountyPerCompletion);
                                            console.log(`✅ Challenge #${cid} completed! Payout TX: https://evm-testnet.flowscan.io/tx/${challengePayoutTx}`);

                                            logAgentActivity('payout_executed', {
                                                status: 'success',
                                                challengeId: cid,
                                                payoutTx: challengePayoutTx,
                                                user: explorerAddress,
                                                tokenId: mintedTokenId,
                                                trustReceiptId,
                                            });
                                            break;
                                        }
                                    }
                                } catch (chErr) {
                                    // Skip invalid challenge IDs
                                }
                            }
                        } catch (challengeErr) {
                            console.error('⚠️ Challenge check failed:', challengeErr.message);
                        }
                    }

                } else {
                    logAgentActivity('rejected', {
                        status: 'rejected',
                        user: explorerAddress,
                        aiResponse: aiAnswer,
                    });
                }
            } catch (chainErr) {
                console.error("❌ Blockchain TX failed:", chainErr.message);
            }

        if (isApproved && req.user) {
            try {
                const userId = req.user.id;
                const { data: userProfile } = await supabaseAdmin
                    .from('profiles')
                    .select('geo_balance')
                    .eq('id', userId)
                    .single();

                const reward = 10;
                const newBalance = (userProfile?.geo_balance || 0) + reward;

                await supabaseAdmin.from('profiles')
                    .update({ geo_balance: Math.round(newBalance * 100) / 100 })
                    .eq('id', userId);

                await supabaseAdmin.from('transactions').insert({
                    user_id: userId,
                    type: 'qr_visit',
                    amount: reward,
                    description: `Photo verified: ${businessName}`,
                    business_name: businessName,
                });

                console.log(`📊 Supabase synced: balance=${newBalance.toFixed(2)}, visit="${businessName}"`);
            } catch (syncErr) {
                console.error('⚠️ Supabase sync failed:', syncErr.message);
            }
        }

        res.json({
            success: true,
            approved: isApproved,
            message: isApproved ? 'AI verified the location!' : 'AI could not verify the target object.',
            raw_ai_response: aiAnswer,
            blockchain: {
                txHash,
                flowscanUrl,
                contract: CONTRACT_ADDRESS,
                reward: isApproved ? reward : 0,
                trustReceipt: {
                    id: trustReceiptId,
                    txHash: trustReceiptTx,
                    contract: TRUST_RECEIPTS_ADDRESS || null,
                },
                challenge: {
                    payoutTx: challengePayoutTx,
                    bounty: challengeBounty,
                    contract: CHALLENGE_MANAGER_ADDRESS || null,
                }
            }
        });

    } catch (error) {
        console.error("Error during validation:", error);
        const aiAnswer = error.response?.data?.error?.message || error.message || "Unknown API Error";
        console.log("Fallback to mock validation triggered.", aiAnswer);
        res.json({
            success: true,
            approved: false,
            message: `API Error: ${aiAnswer}`,
            raw_ai_response: "NO (Fallback)",
            blockchain: { txHash: null, flowscanUrl: null, contract: CONTRACT_ADDRESS, reward: 0, buildingType: null },
        });
    }
});

// --- Player Stats Endpoint ---
app.get('/api/stats/:address', async (req, res) => {
    try {
        let flowBalance = '0';
        try {
            const bal = await provider.getBalance(req.params.address);
            flowBalance = ethers.formatEther(bal);
        } catch {}
        res.json({ address: req.params.address, flowBalance });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/properties/:address', (req, res) => res.json({ properties: [] }));
app.get('/api/marketplace', (req, res) => res.json({ listings: [] }));

// ============================
// B2B Challenge Management API
// ============================

// POST /api/challenges/create — Create a challenge (server-side wallet signs)
app.post('/api/challenges/create', requireAuth, async (req, res) => {
    try {
        if (!challengeManagerContract) {
            return res.status(503).json({ error: 'ChallengeManager contract not loaded' });
        }

        const { name, lat, lng, bountyPerCompletion, maxCompletions, durationDays, radiusMeters, placeId } = req.body;

        if (!name || !lat || !lng || !bountyPerCompletion) {
            return res.status(400).json({ error: 'Missing required fields: name, lat, lng, bountyPerCompletion' });
        }

        const bountyWei = ethers.parseEther(String(bountyPerCompletion));
        const maxSlots = parseInt(maxCompletions) || 5;
        const duration = parseInt(durationDays) || 7;
        const radius = parseInt(radiusMeters) || 100;
        const totalFunding = bountyWei * BigInt(maxSlots);
        const ipfsMetadata = placeId ? JSON.stringify({ placeId, placeName: name }) : '';

        console.log(`\n🏢 B2B: Creating challenge "${name}"`);
        console.log(`   Location: ${lat}, ${lng}`);
        console.log(`   Place ID: ${placeId || 'N/A'}`);
        console.log(`   Bounty: ${bountyPerCompletion} FLOW × ${maxSlots} slots = ${ethers.formatEther(totalFunding)} FLOW`);

        const deployerBalance = await provider.getBalance(wallet.address);
        if (deployerBalance < totalFunding) {
            console.log(`⚠️ Deployer low balance. Need ${ethers.formatEther(totalFunding)} FLOW, have ${ethers.formatEther(deployerBalance)} FLOW — funding what we can`);
        }

        const tx = await challengeManagerContract.createChallenge(
            name,
            ipfsMetadata,
            Math.round(lat * 1e6),
            Math.round(lng * 1e6),
            bountyWei,
            maxSlots,
            duration,
            true,
            radius,
            { value: totalFunding }
        );
        const receipt = await tx.wait();

        // Parse challenge ID from event
        const event = receipt.logs?.find(l => {
            try {
                const parsed = challengeManagerContract.interface.parseLog(l);
                return parsed && parsed.name === 'ChallengeCreated';
            } catch { return false; }
        });
        const challengeId = event ? Number(challengeManagerContract.interface.parseLog(event).args.challengeId) : 0;

        console.log(`✅ Challenge #${challengeId} created! TX: ${tx.hash}`);

        res.json({
            success: true,
            challengeId,
            txHash: tx.hash,
            flowscanUrl: `https://evm-testnet.flowscan.io/tx/${tx.hash}`,
            totalFunding: ethers.formatEther(totalFunding),
        });

    } catch (error) {
        console.error('❌ Challenge creation failed:', error);
        res.status(500).json({ error: error.message || 'Failed to create challenge' });
    }
});

// GET /api/challenges — List all challenges
app.get('/api/challenges', async (req, res) => {
    try {
        if (!challengeManagerContract) {
            return res.status(503).json({ error: 'ChallengeManager not loaded' });
        }

        const nextId = await challengeManagerContract.nextChallengeId();
        const challenges = [];

        for (let i = 1; i < nextId; i++) {
            try {
                const c = await challengeManagerContract.getChallenge(i);
                const completions = await challengeManagerContract.getCompletions(i);

                challenges.push({
                    id: i,
                    creator: c.creator,
                    name: c.name,
                    ipfsMetadata: c.ipfsMetadata,
                    placeId: (() => { try { return JSON.parse(c.ipfsMetadata).placeId; } catch { return ''; } })(),
                    lat: Number(c.lat) / 1e6,
                    lng: Number(c.lng) / 1e6,
                    bountyPerCompletion: ethers.formatEther(c.bountyPerCompletion),
                    maxCompletions: Number(c.maxCompletions),
                    currentCompletions: Number(c.currentCompletions),
                    deadline: Number(c.deadline),
                    status: ['Active', 'Completed', 'Cancelled', 'Expired'][Number(c.status)],
                    completions: completions.map(comp => ({
                        user: comp.user,
                        tokenId: Number(comp.tokenId),
                        trustReceiptId: Number(comp.trustReceiptId),
                        completedAt: Number(comp.completedAt),
                        paid: comp.paid,
                    })),
                });
            } catch {
                // Skip invalid IDs
            }
        }

        res.json({ challenges, total: challenges.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/challenges/:id — Get single challenge details
app.get('/api/challenges/:id', async (req, res) => {
    try {
        if (!challengeManagerContract) {
            return res.status(503).json({ error: 'ChallengeManager not loaded' });
        }

        const id = parseInt(req.params.id);
        const c = await challengeManagerContract.getChallenge(id);
        const completions = await challengeManagerContract.getCompletions(id);
        const stats = await challengeManagerContract.getChallengeStats(id);

        res.json({
            challenge: {
                id,
                creator: c.creator,
                name: c.name,
                ipfsMetadata: c.ipfsMetadata,
                lat: Number(c.lat) / 1e6,
                lng: Number(c.lng) / 1e6,
                bountyPerCompletion: ethers.formatEther(c.bountyPerCompletion),
                maxCompletions: Number(c.maxCompletions),
                currentCompletions: Number(c.currentCompletions),
                createdAt: Number(c.createdAt),
                deadline: Number(c.deadline),
                status: ['Active', 'Completed', 'Cancelled', 'Expired'][Number(c.status)],
                requiresExactLocation: c.requiresExactLocation,
                locationRadiusMeters: Number(c.locationRadiusMeters),
                totalPaid: ethers.formatEther(stats.totalPaid),
                remaining: ethers.formatEther(stats.remaining),
                isExpired: stats.isExpired,
                canRefund: stats.canRefund,
            },
            completions: completions.map(comp => ({
                user: comp.user,
                tokenId: Number(comp.tokenId),
                trustReceiptId: Number(comp.trustReceiptId),
                completedAt: Number(comp.completedAt),
                paid: comp.paid,
            })),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/challenges/:id/cancel — Cancel challenge (creator only)
app.post('/api/challenges/:id/cancel', requireAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const challenge = await challengeManagerContract.getChallenge(id);
        const creator = challenge.creator;
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('evm_address')
            .eq('id', req.user.id)
            .single();
        if (!profile?.evm_address || profile.evm_address.toLowerCase() !== creator.toLowerCase()) {
            return res.status(403).json({ error: 'Only the challenge creator can cancel this challenge' });
        }
        const tx = await challengeManagerContract.cancelChallenge(id);
        const receipt = await tx.wait();

        res.json({
            success: true,
            txHash: receipt.hash,
            flowscanUrl: `https://evm-testnet.flowscan.io/tx/${receipt.hash}`,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/places/search — Google Places search proxy
app.get('/api/places/search', requireAuth, async (req, res) => {
    try {
        const query = req.query.query || '';
        if (!query) return res.status(400).json({ error: 'Query parameter required' });

        const serperRes = await fetch('https://google.serper.dev/places', {
            method: 'POST',
            headers: {
                'X-API-KEY': process.env.SERPER_API_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ q: query, num: 10 }),
        });

        if (!serperRes.ok) {
            return res.status(serperRes.status).json({ error: 'Places API error' });
        }

        const data = await serperRes.json();
        const places = (data.places || []).map((p, i) => ({
            id: i + 1,
            name: p.title || p.name,
            address: p.address,
            lat: p.latitude || p.lat,
            lng: p.longitude || p.lng,
            category: p.type || 'Place',
            rating: p.rating,
            placeId: p.cid || '',
        }));

        res.json({ places, total: places.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================
// QR Code System API (Pivot: Verified Foot Traffic Protocol)
// ============================

function generateQRCodeString(businessName, challengeId, bounty) {
    const nonce = Math.random().toString(36).substring(2, 8);
    return `GEOCORP:${challengeId || '0'}:${businessName}:${bounty}:${nonce}`;
}

app.post('/api/qr/issue', requireAuth, async (req, res) => {
    try {
        const { businessName, lat, lng, bountyAmount, challengeId, maxScans } = req.body;
        if (!businessName) return res.status(400).json({ error: 'businessName required' });

        const bounty = bountyAmount || '0.1';
        const code = generateQRCodeString(businessName, challengeId || 0, bounty);

        const { data, error } = await supabaseAdmin
            .from('qr_codes')
            .insert({
                code,
                challenge_id: challengeId || null,
                business_name: businessName,
                business_address: req.body.businessAddress || '',
                lat: lat || 0,
                lng: lng || 0,
                bounty_amount: bounty,
                issued_by: req.user.id,
                max_scans: maxScans || 10,
            })
            .select()
            .single();

        if (error) throw error;

        const qrDataUrl = await QRCode.toDataURL(code, {
            width: 400,
            margin: 2,
            color: { dark: '#15803D', light: '#F8FAFC' },
        });

        await supabaseAdmin.from('qr_codes')
            .update({ qr_data_url: qrDataUrl })
            .eq('id', data.id);

        logAgentActivity('qr_issued', {
            status: 'success',
            qrId: data.id,
            businessName,
            bounty,
            challengeId: challengeId || null,
        });

        console.log(`📌 QR issued for "${businessName}" (bounty: ${bounty} FLOW, code: ${code.substring(0, 30)}...)`);

        res.json({
            success: true,
            qr: {
                id: data.id,
                code,
                qrDataUrl,
                businessName,
                bounty,
                expiresAt: data.expires_at,
            },
        });
    } catch (err) {
        console.error('❌ QR issue failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/qr/verify', requireAuth, async (req, res) => {
    try {
        const { code, lat, lng, photo } = req.body;
        if (!code) return res.status(400).json({ error: 'QR code string required' });

        const userId = req.user.id;

        const { data: qr, error: qrErr } = await supabaseAdmin
            .from('qr_codes')
            .select('*')
            .eq('code', code)
            .eq('active', true)
            .single();

        if (qrErr || !qr) {
            return res.status(404).json({ error: 'Invalid or expired QR code' });
        }

        if (new Date(qr.expires_at) < new Date()) {
            await supabaseAdmin.from('qr_codes').update({ active: false }).eq('id', qr.id);
            return res.status(410).json({ error: 'QR code expired' });
        }

        if (qr.scan_count >= qr.max_scans) {
            await supabaseAdmin.from('qr_codes').update({ active: false }).eq('id', qr.id);
            return res.status(429).json({ error: 'QR code scan limit reached' });
        }

        const { data: existingVisit } = await supabaseAdmin
            .from('visits')
            .select('id')
            .eq('user_id', userId)
            .eq('qr_code_id', qr.id)
            .limit(1);

        if (existingVisit && existingVisit.length > 0) {
            return res.status(409).json({ error: 'Already scanned this QR code' });
        }

        if (lat && lng) {
            const latDiff = Math.abs(lat - (qr.lat || 0));
            const lngDiff = Math.abs(lng - (qr.lng || 0));
            const distM = Math.sqrt((latDiff * 111000) ** 2 + (lngDiff * 111000 * Math.cos(lat * Math.PI / 180)) ** 2);
            if (distM > 500) {
                return res.status(403).json({ error: `Too far from business (${Math.round(distM)}m). Must be within 500m.` });
            }
        }

        let trustReceiptId = null;
        let challengePayoutTx = null;
        let challengeBounty = null;

        if (trustReceiptsContract) {
            try {
                const geoHash = `${(qr.lat || 0).toFixed(2)},${(qr.lng || 0).toFixed(2)}`;
                const confScore = 9900;

                const trustTx = await trustReceiptsContract.mintTrustReceipt(
                    explorerAddr,
                    1,
                    "qr-verifier-v1",
                    "qr-code-verification",
                    confScore,
                    BigInt(Math.round((qr.lat || 0) * 1e6)),
                    BigInt(Math.round((qr.lng || 0) * 1e6)),
                    geoHash,
                    qr.challenge_id || 0,
                    0,
                    code.substring(0, 32)
                );
                const trustReceipt = await trustTx.wait();
                const receiptEvent = trustReceipt.logs?.find(l => {
                    try {
                        const parsed = trustReceiptsContract.interface.parseLog(l);
                        return parsed && parsed.name === 'TrustReceiptMinted';
                    } catch { return false; }
                });
                if (receiptEvent) {
                    trustReceiptId = Number(trustReceiptsContract.interface.parseLog(receiptEvent).args.receiptId);
                }
                console.log(`🏷️ TrustReceipt minted for QR visit: #${trustReceiptId}`);
            } catch (trustErr) {
                console.error('⚠️ TrustReceipt mint failed:', trustErr.message);
            }
        }

        if (challengeManagerContract && qr.challenge_id) {
            try {
                const challenge = await challengeManagerContract.getChallenge(qr.challenge_id);
                const isActive = Number(challenge.status) === 0;
                const hasCompleted = await challengeManagerContract.hasUserCompleted(qr.challenge_id, explorerAddr);

                if (isActive && !hasCompleted) {
                    const completeTx = await challengeManagerContract.completeChallenge(
                        qr.challenge_id,
                        explorerAddr,
                        0,
                        BigInt(trustReceiptId || 0)
                    );
                    const completeReceipt = await completeTx.wait();
                    challengePayoutTx = completeReceipt.hash;
                    challengeBounty = ethers.formatEther(challenge.bountyPerCompletion);
                    console.log(`🎯 Challenge #${qr.challenge_id} completed via QR! Payout TX: ${challengePayoutTx}`);

                    logAgentActivity('payout_executed', {
                        status: 'success',
                        challengeId: qr.challenge_id,
                        payoutTx: challengePayoutTx,
                        user: explorerAddr,
                        method: 'qr',
                    });
                }
            } catch (chErr) {
                console.error('⚠️ Challenge payout via QR failed:', chErr.message);
            }
        }

        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('evm_address, geo_balance')
            .eq('id', userId)
            .single();

        const visitCount = await supabaseAdmin
            .from('visits')
            .select('id', { count: 'exact' })
            .eq('user_id', userId)
            .eq('business_name', qr.business_name);

        const totalVisits = (visitCount.count || 0) + 1;
        const badgeEarned = totalVisits >= 5;

        await supabaseAdmin.from('visits').insert({
            user_id: userId,
            qr_code_id: qr.id,
            business_name: qr.business_name,
            lat: lat || qr.lat,
            lng: lng || qr.lng,
            bounty_paid: challengeBounty || qr.bounty_amount,
            trust_receipt_id: trustReceiptId,
            challenge_id: qr.challenge_id,
            badge_earned: badgeEarned && totalVisits === 5,
            photo_cid: photo || null,
        });

        await supabaseAdmin.from('qr_codes')
            .update({ scan_count: qr.scan_count + 1 })
            .eq('id', qr.id);

        if (qr.scan_count + 1 >= qr.max_scans) {
            await supabaseAdmin.from('qr_codes').update({ active: false }).eq('id', qr.id);
        }

        const bountyNum = parseFloat(challengeBounty || qr.bounty_amount || '0');
        const multiplier = badgeEarned && totalVisits === 5 ? 1.5 : 1;
        const finalBounty = bountyNum * multiplier;

        const goldReward = 5;
        if (profile) {
            const newBalance = (profile.geo_balance || 0) + goldReward;
            await supabaseAdmin.from('profiles')
                .update({ geo_balance: Math.round(newBalance * 100) / 100 })
                .eq('id', userId);

            await supabaseAdmin.from('transactions').insert({
                user_id: userId,
                type: 'qr_visit',
                amount: goldReward,
                description: `QR Visit: ${qr.business_name} (+${finalBounty.toFixed(2)} FLOW bounty)`,
                business_name: qr.business_name,
            });
        }

        logAgentActivity('qr_verified', {
            status: 'success',
            businessName: qr.business_name,
            bounty: finalBounty,
            badgeEarned,
            trustReceiptId,
            challengeId: qr.challenge_id,
        });

        console.log(`✅ QR verified: "${qr.business_name}" → ${finalBounty.toFixed(2)} FLOW${badgeEarned ? ' 🏅 BADGE EARNED!' : ''} (visit #${totalVisits})`);

        res.json({
            success: true,
            approved: true,
            message: `Visit verified! +${finalBounty.toFixed(2)} FLOW`,
            visit: {
                businessName: qr.business_name,
                bounty: finalBounty,
                badgeEarned,
                totalVisits,
                trustReceiptId,
                challengePayoutTx,
                challengeBounty,
            },
            blockchain: {
                trustReceipt: {
                    id: trustReceiptId,
                    contract: TRUST_RECEIPTS_ADDRESS || null,
                },
                challenge: {
                    payoutTx: challengePayoutTx,
                    bounty: challengeBounty,
                    contract: CHALLENGE_MANAGER_ADDRESS || null,
                },
            },
        });
    } catch (err) {
        console.error('❌ QR verify failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/qr/list', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('qr_codes')
            .select('*')
            .eq('issued_by', req.user.id)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;
        res.json({ qrCodes: data || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/qr/active', async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat);
        const lng = parseFloat(req.query.lng);
        const radiusKm = parseFloat(req.query.radius) || 5;

        const { data, error } = await supabaseAdmin
            .from('qr_codes')
            .select('id, business_name, lat, lng, bounty_amount, scan_count, max_scans, active, expires_at, qr_data_url')
            .eq('active', true);

        if (error) throw error;

        let nearby = (data || []).filter(qr => qr.lat && qr.lng);
        if (!isNaN(lat) && !isNaN(lng)) {
            nearby = nearby.filter(qr => {
                const dLat = (qr.lat - lat) * 111;
                const dLng = (qr.lng - lng) * 111 * Math.cos(lat * Math.PI / 180);
                return Math.sqrt(dLat * dLat + dLng * dLng) <= radiusKm;
            });
        }

        nearby.sort((a, b) => {
            if (isNaN(lat) || isNaN(lng)) return 0;
            const dA = Math.sqrt(((a.lat - lat) * 111) ** 2 + ((a.lng - lng) * 111 * Math.cos(lat * Math.PI / 180)) ** 2);
            const dB = Math.sqrt(((b.lat - lat) * 111) ** 2 + ((b.lng - lng) * 111 * Math.cos(lat * Math.PI / 180)) ** 2);
            return dA - dB;
        });

        const result = nearby.slice(0, 50).map(qr => ({
            id: qr.id,
            businessName: qr.business_name,
            lat: qr.lat,
            lng: qr.lng,
            bountyAmount: qr.bounty_amount,
            scansLeft: qr.max_scans - qr.scan_count,
            maxScans: qr.max_scans,
            expiresAt: qr.expires_at,
        }));

        res.json({ qrCodes: result, total: result.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/qr/generate-image', async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ error: 'code required' });

        const qrDataUrl = await QRCode.toDataURL(code, {
            width: 400,
            margin: 2,
            color: { dark: '#15803D', light: '#F8FAFC' },
        });

        res.json({ qrDataUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/visits', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('visits')
            .select('*')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        res.json({ visits: data || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================
// x402 Payment Simulation Headers
// ============================
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/qr/') || req.path.startsWith('/challenges/')) {
        res.setHeader('X-402-Payment-Required', 'flow');
        res.setHeader('X-402-Network', 'flow-testnet');
        res.setHeader('X-402-Amount', '0.1');
        res.setHeader('X-402-Recipient', wallet?.address || CONTRACT_ADDRESS);
    }
    next();
});

// --- Static Frontend Serving ---
const distPath = join(__dirname, '..', 'dist');
if (existsSync(distPath)) {
    app.use(express.static(distPath));
    // All non-API routes → serve index.html (SPA routing)
    app.use((req, res, next) => {
        if (req.method === 'GET' && !req.path.startsWith('/api')) {
            res.sendFile(join(distPath, 'index.html'));
        } else {
            next();
        }
    });
    console.log('📁 Serving static frontend from /dist');
} else {
    console.log('⚠️ /dist folder not found. Only API routes are active.');
}

// ============================
// SignalMap: DePIN Coverage Intelligence
// ============================

// POST /api/readings — Mapper submits signal data
app.post('/api/readings', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            lat,
            lng,
            carrier,
            technology,
            signalDbm,
            wifiCount,
            speedDown,
            speedUp,
            speedSource,
            speedError,
            latencyMs,
            networkType,
            simOperator,
            networkOperator,
            mcc,
            mnc,
            cellId,
            tac,
            lac,
            pci,
            psc,
            rsrp,
            rsrq,
            sinr,
            asuLevel,
            dbm,
            isRegistered,
            wifiSsid,
            wifiBssid,
            wifiRssi,
            wifiLinkSpeedMbps,
            wifiFrequencyMhz,
            wifiIpAddress,
            telemetryRaw,
        } = req.body;

        if (!lat || !lng) {
            return res.status(400).json({ error: 'lat and lng required' });
        }

        const REWARD_PER_READING = 0.001;

        const baseReadingPayload = {
            user_id: userId,
            lat,
            lng,
            carrier: carrier || null,
            technology: technology || null,
            signal_dbm: signalDbm ?? null,
            wifi_count: wifiCount ?? 0,
            speed_down: speedDown ?? null,
            speed_up: speedUp ?? null,
            status: 'pending',
            error_message: speedError ? `speed_probe:${speedError}` : null,
            bounty_paid: 0,
        };

        const extendedReadingPayload = {
            ...baseReadingPayload,
            network_type: networkType || null,
            sim_operator: simOperator || null,
            network_operator: networkOperator || null,
            mcc: mcc || null,
            mnc: mnc || null,
            cell_id: cellId != null ? String(cellId) : null,
            tac: tac ?? null,
            lac: lac ?? null,
            pci: pci ?? null,
            psc: psc ?? null,
            rsrp: rsrp ?? null,
            rsrq: rsrq ?? null,
            sinr: sinr ?? null,
            asu_level: asuLevel ?? null,
            dbm: dbm ?? null,
            is_registered: isRegistered ?? null,
            wifi_ssid: wifiSsid || null,
            wifi_bssid: wifiBssid || null,
            wifi_rssi: wifiRssi ?? null,
            wifi_link_speed: wifiLinkSpeedMbps ?? null,
            wifi_frequency: wifiFrequencyMhz ?? null,
            wifi_ip_address: wifiIpAddress || null,
            latency_ms: latencyMs ?? null,
            speed_source: speedSource || null,
            speed_error: speedError || null,
            telemetry_raw: telemetryRaw || null,
        };

        let { data: pendingReading, error: pendingError } = await supabaseAdmin
            .from('signal_readings')
            .insert(extendedReadingPayload)
            .select()
            .single();

        if (pendingError && /schema cache|column|Could not find/i.test(pendingError.message || '')) {
            console.warn(`Extended telemetry insert skipped, retrying base schema: ${pendingError.message}`);
            const retry = await supabaseAdmin
                .from('signal_readings')
                .insert(baseReadingPayload)
                .select()
                .single();
            pendingReading = retry.data;
            pendingError = retry.error;
        }

        if (pendingError) throw pendingError;

        const initialQualityStatus = speedDown != null || speedUp != null || latencyMs != null
            ? 'ok'
            : (speedError ? 'failed' : 'missing');
        console.log(`Reading accepted: id=${pendingReading.id} operator=${networkOperator || carrier || 'Unknown'} transport=${networkType || 'unknown'} tech=${technology || 'Unknown'} quality=${initialQualityStatus} @ ${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`);

        res.status(202).json({
            success: true,
            accepted: true,
            pending: true,
            readingId: pendingReading.id,
            reading: pendingReading,
            trustReceipt: null,
            bounty: 0,
        });

        enqueueSignalProcessing(pendingReading.id, async () => {
            const failReading = async (message) => {
                await supabaseAdmin.from('signal_readings')
                    .update({ status: 'failed', error_message: message })
                    .eq('id', pendingReading.id);
                console.error(`[reading:${pendingReading.id}] failed: ${message}`);
            };

            try {
                let trustReceiptId = null;
                let trustReceiptTx = null;

                const { data: profile } = await supabaseAdmin
                    .from('profiles')
                    .select('evm_address, signal_balance')
                    .eq('id', userId)
                    .single();

                const receiptRecipient = profile?.evm_address || req.user.evm_address;
                if (!trustReceiptsContract) {
                    return failReading('TrustReceipts contract is not configured');
                }
                if (!receiptRecipient || !ethers.isAddress(receiptRecipient)) {
                    return failReading('No valid EVM address for TrustReceipt recipient');
                }

                const geoHash = `${lat.toFixed(2)},${lng.toFixed(2)}`;
                const confidenceScore = Math.min(
                    signalDbm ? Math.max(7000, Math.min(9900, 11000 + signalDbm * 20)) : ((wifiCount || 0) > 5 ? 9500 : 8000),
                    10000
                );

                const trustTx = await trustReceiptsContract.mintTrustReceipt(
                    receiptRecipient,
                    0,
                    'signal-verifier',
                    carrier || 'unknown-carrier',
                    confidenceScore,
                    BigInt(Math.round(lat * 1e6)),
                    BigInt(Math.round(lng * 1e6)),
                    geoHash,
                    0,
                    BigInt(0),
                    `signal:${technology}:${signalDbm || 'unknown'}dBm`
                );
                const receipt = await trustTx.wait();
                trustReceiptTx = receipt.hash;

                const receiptEvent = receipt.logs?.find(l => {
                    try {
                        const parsed = trustReceiptsContract.interface.parseLog(l);
                        return parsed && parsed.name === 'TrustReceiptMinted';
                    } catch { return false; }
                });
                if (receiptEvent) {
                    trustReceiptId = Number(trustReceiptsContract.interface.parseLog(receiptEvent).args.receiptId);
                }

                logAgentActivity('trust_receipt_minted', {
                    status: 'success',
                    receiptId: trustReceiptId,
                    txHash: trustReceiptTx,
                    agentId: 'signal-verifier',
                    confidenceScore,
                    carrier,
                    technology,
                    signalDbm,
                    readingId: pendingReading.id,
                });

                const { error: readingError } = await supabaseAdmin.from('signal_readings')
                    .update({
                        trust_receipt_id: trustReceiptId,
                        trust_receipt_tx: trustReceiptTx,
                        status: 'confirmed',
                        error_message: speedError ? `speed_probe:${speedError}` : null,
                        bounty_paid: REWARD_PER_READING,
                    })
                    .eq('id', pendingReading.id);
                if (readingError) {
                    return failReading(`db_update_failed:${readingError.message}`);
                }

                const rewardResult = await sendSignalReward({
                    readingId: pendingReading.id,
                    to: profile?.evm_address,
                    amountEth: REWARD_PER_READING,
                });
                const rewardTxHash = rewardResult.txHash;
                const rewardStatus = rewardResult.status;
                const rewardError = rewardResult.error;
                if (rewardStatus === 'paid') {
                    console.log(`Signal reward paid: reading=${pendingReading.id} to=${profile.evm_address} amount=${REWARD_PER_READING} FLOW tx=${rewardTxHash}`);
                } else if (rewardStatus === 'skipped') {
                    console.warn(`Signal reward skipped: reading=${pendingReading.id} to=${profile?.evm_address || 'n/a'} reason=${rewardError}`);
                } else {
                    console.error(`Signal reward failed: reading=${pendingReading.id} to=${profile?.evm_address || 'n/a'} error=${rewardError}`);
                }

                const rewardUpdate = await supabaseAdmin.from('signal_readings')
                    .update({
                        reward_tx_hash: rewardTxHash,
                        reward_status: rewardStatus,
                        reward_error: rewardError,
                    })
                    .eq('id', pendingReading.id);
                if (rewardUpdate.error && /schema cache|column|Could not find/i.test(rewardUpdate.error.message || '')) {
                    console.warn(`Reward metadata skipped until migration is applied: ${rewardUpdate.error.message}`);
                } else if (rewardUpdate.error) {
                    console.warn(`Reward metadata update failed: ${rewardUpdate.error.message}`);
                }

                if (profile) {
                    const newBalance = (profile.signal_balance || 0) + REWARD_PER_READING;
                    await supabaseAdmin.from('profiles')
                        .update({ signal_balance: Math.round(newBalance * 10000) / 10000 })
                        .eq('id', userId);
                }

                await supabaseAdmin.from('transactions').insert({
                    user_id: userId,
                    type: 'signal_reading',
                    amount: REWARD_PER_READING,
                    description: `Signal: ${carrier || '?'} ${technology || '?'} ${signalDbm || '?'}dBm`,
                });

                const speedLabel = speedDown != null ? `${speedDown}Mbps` : 'n/a';
                const uploadLabel = speedUp != null ? `${speedUp}Mbps` : 'n/a';
                const latencyLabel = latencyMs != null ? `${latencyMs}ms` : 'n/a';
                const speedSourceLabel = speedSource || 'unknown';
                const speedErrorLabel = speedError || 'none';
                const signalLabel = signalDbm != null ? `${signalDbm}dBm` : 'n/a';
                const cellDiagnostics = telemetryRaw?.native?.cellInfoUnavailable || 'ok';
                console.log(`Reading confirmed: id=${pendingReading.id} operator=${networkOperator || carrier || 'Unknown'} sim=${simOperator || 'n/a'} transport=${networkType || 'unknown'} tech=${technology || 'Unknown'} signal=${signalLabel} rsrp=${rsrp ?? 'n/a'} rsrq=${rsrq ?? 'n/a'} sinr=${sinr ?? 'n/a'} cell=${cellId ?? 'n/a'} tac=${tac ?? lac ?? 'n/a'} pci=${pci ?? psc ?? 'n/a'} wifiSsid=${wifiSsid || 'n/a'} wifiRssi=${wifiRssi ?? 'n/a'} speedDown=${speedLabel} speedUp=${uploadLabel} latency=${latencyLabel} speedSource=${speedSourceLabel} speedError=${speedErrorLabel} cellDiagnostics=${cellDiagnostics} reward=${rewardStatus} rewardTx=${rewardTxHash || 'n/a'} wifiCount=${wifiCount || 0} @ ${lat.toFixed(4)},${lng.toFixed(4)} -> +${REWARD_PER_READING} FLOW tx=${trustReceiptTx || 'n/a'}`);
            } catch (err) {
                await failReading(`processing_failed:${err.message}`);
            }
        });
    } catch (error) {
        console.error('Error saving reading:', error);
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/readings/:id/telemetry', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const readingId = req.params.id;
        const { speedDown, speedUp, speedSource, speedError, latencyMs, telemetryRaw } = req.body;

        const extendedUpdate = {
            speed_down: speedDown ?? null,
            speed_up: speedUp ?? null,
            latency_ms: latencyMs ?? null,
            speed_source: speedSource || null,
            speed_error: speedError || null,
            telemetry_raw: telemetryRaw || null,
        };

        let { data, error } = await supabaseAdmin
            .from('signal_readings')
            .update(extendedUpdate)
            .eq('id', readingId)
            .eq('user_id', userId)
            .select('id, speed_down, speed_up, latency_ms, speed_source, speed_error')
            .single();

        if (error && /schema cache|column|Could not find/i.test(error.message || '')) {
            console.warn(`Extended telemetry update skipped, retrying base schema: ${error.message}`);
            const retry = await supabaseAdmin
                .from('signal_readings')
                .update({
                    speed_down: speedDown ?? null,
                    speed_up: speedUp ?? null,
                })
                .eq('id', readingId)
                .eq('user_id', userId)
                .select('id, speed_down, speed_up')
                .single();
            data = retry.data;
            error = retry.error;
        }

        if (error || !data) {
            return res.status(404).json({ error: 'Reading not found' });
        }

        const qualityStatus = speedDown != null || speedUp != null || latencyMs != null
            ? 'ok'
            : (speedError ? 'failed' : 'missing');
        console.log(`Reading quality updated: id=${readingId} quality=${qualityStatus} speedDown=${speedDown ?? 'n/a'} speedUp=${speedUp ?? 'n/a'} latency=${latencyMs ?? 'n/a'} source=${speedSource || 'unknown'} error=${speedError || 'none'}`);

        return res.json({ success: true, reading: data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/readings/:id/status', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const readingId = req.params.id;
        const { data, error } = await supabaseAdmin
            .from('signal_readings')
            .select('id, status, trust_receipt_id, trust_receipt_tx, error_message, bounty_paid, reward_tx_hash, reward_status, reward_error, created_at')
            .eq('id', readingId)
            .eq('user_id', userId)
            .single();

        let reading = data;
        let readError = error;
        if (readError && /schema cache|column|Could not find/i.test(readError.message || '')) {
            const retry = await supabaseAdmin
                .from('signal_readings')
                .select('id, status, trust_receipt_id, trust_receipt_tx, error_message, bounty_paid, created_at')
                .eq('id', readingId)
                .eq('user_id', userId)
                .single();
            reading = retry.data;
            readError = retry.error;
        }

        if (readError || !reading) {
            return res.status(404).json({ error: 'Reading not found' });
        }
        return res.json({
            success: true,
            readingId: reading.id,
            status: reading.status || 'pending',
            trustReceiptId: reading.trust_receipt_id,
            trustReceiptTx: reading.trust_receipt_tx,
            rewardTxHash: reading.reward_tx_hash || null,
            rewardStatus: reading.reward_status || 'skipped',
            rewardError: reading.reward_error || null,
            errorMessage: reading.error_message,
            bountyPaid: reading.bounty_paid || 0,
            createdAt: reading.created_at,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// GET /api/coverage — Free aggregated heatmap data
app.get('/api/coverage', async (req, res) => {
    try {
        const { bounds, carrier, technology } = req.query;

        let query = supabaseAdmin.from('signal_readings')
            .select('user_id, lat, lng, carrier, sim_operator, network_operator, technology, network_type, signal_dbm, dbm, rsrp, rsrq, sinr, speed_down, speed_up, latency_ms, wifi_count, wifi_ssid, status, created_at');

        if (carrier && carrier !== 'all') {
            query = query.eq('carrier', carrier);
        }
        if (technology && technology !== 'all') {
            query = query.eq('technology', technology);
        }

        const { data: readings, error } = await query.limit(10000);
        if (error) throw error;

        const gridSize = 0.002;
        const grid = {};
        for (const r of (readings || [])) {
            const key = `${(Math.floor(r.lat / gridSize) * gridSize).toFixed(3)},${(Math.floor(r.lng / gridSize) * gridSize).toFixed(3)}`;
            if (!grid[key]) {
                grid[key] = {
                    lat: 0,
                    lng: 0,
                    count: 0,
                    confirmed: 0,
                    users: new Set(),
                    totalSignal: 0,
                    signalCount: 0,
                    totalDownload: 0,
                    downloadCount: 0,
                    totalUpload: 0,
                    uploadCount: 0,
                    totalLatency: 0,
                    latencyCount: 0,
                    wifiSamples: 0,
                    mobileSamples: 0,
                    carriers: new Set(),
                    technologies: new Set(),
                    latestAt: null,
                };
            }
            const cell = grid[key];
            grid[key].lat += r.lat;
            grid[key].lng += r.lng;
            grid[key].count++;
            if (r.status === 'confirmed') cell.confirmed++;
            if (r.user_id) cell.users.add(r.user_id);

            const signalValue = r.rsrp ?? r.signal_dbm ?? r.dbm;
            if (Number.isFinite(Number(signalValue))) {
                cell.totalSignal += Number(signalValue);
                cell.signalCount++;
            }
            if (Number.isFinite(Number(r.speed_down))) {
                cell.totalDownload += Number(r.speed_down);
                cell.downloadCount++;
            }
            if (Number.isFinite(Number(r.speed_up))) {
                cell.totalUpload += Number(r.speed_up);
                cell.uploadCount++;
            }
            if (Number.isFinite(Number(r.latency_ms))) {
                cell.totalLatency += Number(r.latency_ms);
                cell.latencyCount++;
            }

            const transport = String(r.network_type || '').toLowerCase();
            const isWifi = transport.includes('wifi') || r.wifi_ssid || Number(r.wifi_count || 0) > 0;
            if (isWifi) cell.wifiSamples++;
            else cell.mobileSamples++;
            if (r.network_operator || r.carrier || r.sim_operator) cell.carriers.add(r.network_operator || r.carrier || r.sim_operator);
            if (r.technology) cell.technologies.add(r.technology);
            if (!cell.latestAt || new Date(r.created_at) > new Date(cell.latestAt)) cell.latestAt = r.created_at;
        }

        const heatmap = Object.values(grid).map(g => ({
            lat: g.lat / g.count,
            lng: g.lng / g.count,
            count: g.count,
            confirmed: g.confirmed,
            users: g.users.size,
            avgSignal: g.signalCount ? Math.round(g.totalSignal / g.signalCount) : null,
            avgDownload: g.downloadCount ? Math.round((g.totalDownload / g.downloadCount) * 10) / 10 : null,
            avgUpload: g.uploadCount ? Math.round((g.totalUpload / g.uploadCount) * 10) / 10 : null,
            avgLatency: g.latencyCount ? Math.round(g.totalLatency / g.latencyCount) : null,
            wifiSamples: g.wifiSamples,
            mobileSamples: g.mobileSamples,
            carriers: [...g.carriers],
            technologies: [...g.technologies],
            latestAt: g.latestAt,
            freshnessMinutes: g.latestAt ? Math.round((Date.now() - new Date(g.latestAt).getTime()) / 60000) : null,
        }));

        res.set('X-402-Payment-Required', '0.01');
        res.set('X-402-Network', 'flow-testnet');
        res.set('X-402-Amount', '0.01');
        res.set('X-402-Recipient', DEPLOYER_ADDRESS || '');

        res.json({ heatmap, total: heatmap.length, gridSize });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/coverage/detailed — x402 paid granular data
app.get('/api/coverage/detailed', requireAuth, async (req, res) => {
    try {
        const { bounds, carrier, technology, limit } = req.query;
        const maxLimit = Math.min(parseInt(limit) || 500, 2000);

        let query = supabaseAdmin.from('signal_readings')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(maxLimit);

        if (carrier && carrier !== 'all') {
            query = query.eq('carrier', carrier);
        }
        if (technology && technology !== 'all') {
            query = query.eq('technology', technology);
        }

        const { data: readings, error } = await query;
        if (error) throw error;

        res.set('X-402-Payment-Required', '0.01');
        res.set('X-402-Network', 'flow-testnet');
        res.set('X-402-Amount', '0.01');
        res.set('X-402-Recipient', DEPLOYER_ADDRESS || '');

        res.json({ readings: readings || [], count: (readings || []).length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/mapper/stats — Mapper's personal stats
app.get('/api/mapper/stats', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;

        const { data: readingRows, error: readingsError, count: readingCount } = await supabaseAdmin
            .from('signal_readings')
            .select('status, bounty_paid, reward_status', { count: 'exact' })
            .eq('user_id', userId);
        if (readingsError) throw readingsError;

        let lastReward = null;
        const { data: rewardRows, error: rewardError } = await supabaseAdmin
            .from('signal_readings')
            .select('id, reward_tx_hash, reward_status, reward_error, created_at')
            .eq('user_id', userId)
            .eq('reward_status', 'paid')
            .not('reward_tx_hash', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1);
        if (!rewardError && rewardRows?.length) {
            lastReward = rewardRows[0];
        }

        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('signal_balance, evm_address')
            .eq('id', userId)
            .single();

        const readings = readingRows || [];
        const confirmedReadings = readings.filter((reading) => reading.status === 'confirmed');
        const pendingReadings = readings.filter((reading) => reading.status === 'pending').length;
        const failedReadings = readings.filter((reading) => reading.status === 'failed').length;
        const pendingRewards = readings.filter((reading) => reading.reward_status === 'pending').length;
        const failedRewards = readings.filter((reading) => reading.reward_status === 'failed').length;
        const ledgerBalance = confirmedReadings.reduce((sum, reading) => (
            sum + Number(reading.bounty_paid || 0)
        ), 0);
        const signalBalance = Math.round(ledgerBalance * 10000) / 10000;

        let flowBalance = '0';
        if (profile?.evm_address) {
            try {
                const bal = await provider.getBalance(profile.evm_address);
                flowBalance = ethers.formatEther(bal);
            } catch {}
        }

        res.json({
            readings: readingCount || 0,
            signalBalance,
            confirmedReadings: confirmedReadings.length,
            pendingReadings,
            failedReadings,
            pendingRewards,
            failedRewards,
            flowBalance,
            evmAddress: profile?.evm_address || null,
            lastReward,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`\n🚀 SignalMap Server running on port ${port}`);
    console.log(`⛓️  Flow EVM Testnet | GeoCorp: ${CONTRACT_ADDRESS}`);
    if (TRUST_RECEIPTS_ADDRESS) console.log(`🏷️  TrustReceipts: ${TRUST_RECEIPTS_ADDRESS}`);
    if (CHALLENGE_MANAGER_ADDRESS) console.log(`🎯 ChallengeManager: ${CHALLENGE_MANAGER_ADDRESS}`);
    console.log(`📦 IPFS: Pinata ${process.env.PINATA_JWT ? '✅ Connected' : '❌ Not configured'}`);
    console.log(`📡 SignalMap: DePIN Coverage Intelligence`);
});

// Forcibly keep event loop alive and catch any hidden errors causing silent exits
setInterval(() => {}, 60000);

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
});
process.on('exit', (code) => {
    console.log(`Process exiting with code: ${code}`);
});



