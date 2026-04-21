import axios from 'axios';

const DEFAULT_API_BASE = 'https://signalmap-production.up.railway.app';
const configuredBases = [
  process.env.EXPO_PUBLIC_API_BASE_URL,
  process.env.EXPO_PUBLIC_API_FALLBACK_URL,
  DEFAULT_API_BASE,
].filter(Boolean) as string[];
const API_BASES = Array.from(new Set(configuredBases.map((url) => url.replace(/\/$/, ''))));

let activeBaseIndex = 0;

const api = axios.create({
  baseURL: API_BASES[activeBaseIndex],
  timeout: 90000,
  headers: {
    'Content-Type': 'application/json',
    'Bypass-Tunnel-Reminder': 'true',
  },
});

function setActiveBase(index: number) {
  activeBaseIndex = index;
  api.defaults.baseURL = API_BASES[activeBaseIndex];
}

function isNetworkError(error: any) {
  return !error?.response || ['ECONNABORTED', 'ERR_NETWORK'].includes(error?.code);
}

function networkMessage(error: any) {
  if (error?.code === 'ECONNABORTED') return 'Backend request timed out. Check VPN or mobile network.';
  if (isNetworkError(error)) return 'Backend unreachable. Check VPN, Wi-Fi/mobile data, or Railway domain access.';
  return error?.response?.data?.error || error?.message || 'Request failed.';
}

async function requestWithFallback<T>(request: () => Promise<T>): Promise<T> {
  let lastError: any;
  for (let offset = 0; offset < API_BASES.length; offset++) {
    const index = (activeBaseIndex + offset) % API_BASES.length;
    setActiveBase(index);
    try {
      return await request();
    } catch (error: any) {
      lastError = error;
      if (!isNetworkError(error)) throw error;
    }
  }
  const wrapped = new Error(networkMessage(lastError));
  (wrapped as any).cause = lastError;
  throw wrapped;
}

export function getActiveApiBase() {
  return API_BASES[activeBaseIndex] || DEFAULT_API_BASE;
}

export function setAuthToken(token: string | null) {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
}

export async function healthCheck(timeout = 15000) {
  const res = await requestWithFallback(() => api.get('/api/health', { timeout }));
  return res.data;
}

export async function sendReading(data: {
  lat: number;
  lng: number;
  carrier: string;
  technology: string;
  signalDbm: number | null;
  wifiCount: number;
  speedDown?: number | null;
  speedUp?: number | null;
  speedSource?: string | null;
  speedError?: string | null;
  latencyMs?: number | null;
  networkType?: string | null;
  simOperator?: string | null;
  networkOperator?: string | null;
  mcc?: string | null;
  mnc?: string | null;
  cellId?: number | string | null;
  tac?: number | null;
  lac?: number | null;
  pci?: number | null;
  psc?: number | null;
  rsrp?: number | null;
  rsrq?: number | null;
  sinr?: number | null;
  asuLevel?: number | null;
  dbm?: number | null;
  isRegistered?: boolean | null;
  wifiSsid?: string | null;
  wifiBssid?: string | null;
  wifiRssi?: number | null;
  wifiLinkSpeedMbps?: number | null;
  wifiFrequencyMhz?: number | null;
  wifiIpAddress?: string | null;
  telemetryRaw?: Record<string, any>;
}) {
  const res = await requestWithFallback(() => api.post('/api/readings', data, { timeout: 30000 }));
  return res.data;
}

export async function updateReadingTelemetry(readingId: string, data: {
  speedDown?: number | null;
  speedUp?: number | null;
  speedSource?: string | null;
  speedError?: string | null;
  latencyMs?: number | null;
  telemetryRaw?: Record<string, any>;
}) {
  const res = await requestWithFallback(() => api.patch(`/api/readings/${readingId}/telemetry`, data, { timeout: 30000 }));
  return res.data;
}

export async function getReadingStatus(readingId: string) {
  const res = await requestWithFallback(() => api.get(`/api/readings/${readingId}/status`, { timeout: 20000 }));
  return res.data;
}

export async function getMapperStats() {
  const res = await requestWithFallback(() => api.get('/api/mapper/stats', { timeout: 20000 }));
  return res.data;
}

export interface MapperHistoryItem {
  id: string;
  createdAt: string;
  status: 'pending' | 'confirmed' | 'failed' | string;
  rewardStatus: 'pending' | 'paid' | 'failed' | 'skipped' | string;
  bountyPaid: number;
  operator: string;
  transport: string;
  technology: string | null;
  signalDbm: number | null;
  speedDown: number | null;
  speedUp: number | null;
  latencyMs: number | null;
  wifiSsid: string | null;
  trustReceiptTx: string | null;
  rewardTxHash: string | null;
  lat: number;
  lng: number;
}

export interface MapperHistorySession {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  isActive: boolean;
  readings: number;
  confirmedReadings: number;
  pendingReadings: number;
  failedReadings: number;
  earnedFlow: number;
  avgSignalDbm: number | null;
  avgDownload: number | null;
  avgUpload: number | null;
  avgLatency: number | null;
  primaryOperator: string;
  primaryTransport: string;
  wifiVsMobile: {
    wifi: number;
    mobile: number;
  };
  approxDistanceMeters: number;
  approxCoverageKm2: number;
  items: MapperHistoryItem[];
}

export interface MapperHistoryResponse {
  success: true;
  summary: {
    totalSessions: number;
    todaySessions: number;
    totalReadings: number;
    totalEarnedFlow: number;
    todayEarnedFlow: number;
    avgDownload: number | null;
    avgUpload: number | null;
    avgLatency: number | null;
    confirmedReadings: number;
    pendingReadings: number;
    failedReadings: number;
  };
  latestSession: MapperHistorySession | null;
  sessions: MapperHistorySession[];
}

function toFiniteNumber(value: unknown, digits?: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (digits == null) return numeric;
  return Number(numeric.toFixed(digits));
}

function toNullableNumber(value: unknown, digits?: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (digits == null) return numeric;
  return Number(numeric.toFixed(digits));
}

function normalizeMapperHistory(raw: any): MapperHistoryResponse {
  const summary = raw?.summary || {};
  const normalizeItem = (item: any): MapperHistoryItem => ({
    id: String(item?.id || ''),
    createdAt: String(item?.createdAt || item?.created_at || new Date().toISOString()),
    status: item?.status || 'pending',
    rewardStatus: item?.rewardStatus || item?.reward_status || 'pending',
    bountyPaid: toFiniteNumber(item?.bountyPaid ?? item?.bounty_paid, 4),
    operator: item?.operator || item?.networkOperator || item?.carrier || 'Unknown',
    transport: item?.transport || item?.networkType || item?.transportType || 'unknown',
    technology: item?.technology || null,
    signalDbm: toNullableNumber(item?.signalDbm ?? item?.signal_dbm ?? item?.rsrp ?? item?.dbm, 0),
    speedDown: toNullableNumber(item?.speedDown ?? item?.speed_down, 1),
    speedUp: toNullableNumber(item?.speedUp ?? item?.speed_up, 1),
    latencyMs: toNullableNumber(item?.latencyMs ?? item?.latency_ms, 0),
    wifiSsid: item?.wifiSsid ?? item?.wifi_ssid ?? null,
    trustReceiptTx: item?.trustReceiptTx ?? item?.trust_receipt_tx ?? null,
    rewardTxHash: item?.rewardTxHash ?? item?.reward_tx_hash ?? null,
    lat: toFiniteNumber(item?.lat),
    lng: toFiniteNumber(item?.lng),
  });

  const normalizeSession = (session: any, index: number): MapperHistorySession => ({
    sessionId: String(session?.sessionId || session?.session_id || `session-${index + 1}`),
    startedAt: String(session?.startedAt || session?.started_at || session?.endedAt || session?.ended_at || new Date().toISOString()),
    endedAt: String(session?.endedAt || session?.ended_at || session?.startedAt || session?.started_at || new Date().toISOString()),
    durationMinutes: Math.max(1, Math.round(toFiniteNumber(session?.durationMinutes ?? session?.duration_minutes))),
    isActive: Boolean(session?.isActive ?? session?.is_active),
    readings: Math.max(0, Math.round(toFiniteNumber(session?.readings))),
    confirmedReadings: Math.max(0, Math.round(toFiniteNumber(session?.confirmedReadings ?? session?.confirmed_readings))),
    pendingReadings: Math.max(0, Math.round(toFiniteNumber(session?.pendingReadings ?? session?.pending_readings))),
    failedReadings: Math.max(0, Math.round(toFiniteNumber(session?.failedReadings ?? session?.failed_readings))),
    earnedFlow: toFiniteNumber(session?.earnedFlow ?? session?.earned_flow, 4),
    avgSignalDbm: toNullableNumber(session?.avgSignalDbm ?? session?.avg_signal_dbm, 0),
    avgDownload: toNullableNumber(session?.avgDownload ?? session?.avg_download, 1),
    avgUpload: toNullableNumber(session?.avgUpload ?? session?.avg_upload, 1),
    avgLatency: toNullableNumber(session?.avgLatency ?? session?.avg_latency, 0),
    primaryOperator: session?.primaryOperator || session?.primary_operator || 'Unknown',
    primaryTransport: session?.primaryTransport || session?.primary_transport || 'unknown',
    wifiVsMobile: {
      wifi: Math.max(0, Math.round(toFiniteNumber(session?.wifiVsMobile?.wifi ?? session?.wifi_vs_mobile?.wifi))),
      mobile: Math.max(0, Math.round(toFiniteNumber(session?.wifiVsMobile?.mobile ?? session?.wifi_vs_mobile?.mobile))),
    },
    approxDistanceMeters: Math.max(0, Math.round(toFiniteNumber(session?.approxDistanceMeters ?? session?.approx_distance_meters))),
    approxCoverageKm2: toFiniteNumber(session?.approxCoverageKm2 ?? session?.approx_coverage_km2, 2),
    items: Array.isArray(session?.items) ? session.items.map(normalizeItem) : [],
  });

  const sessions = Array.isArray(raw?.sessions) ? raw.sessions.map(normalizeSession) : [];
  const latestSessionRaw = raw?.latestSession || raw?.latest_session || null;
  const latestSession = latestSessionRaw ? normalizeSession(latestSessionRaw, 0) : sessions[0] || null;

  return {
    success: true,
    summary: {
      totalSessions: Math.max(0, Math.round(toFiniteNumber(summary?.totalSessions ?? summary?.total_sessions ?? sessions.length))),
      todaySessions: Math.max(0, Math.round(toFiniteNumber(summary?.todaySessions ?? summary?.today_sessions))),
      totalReadings: Math.max(0, Math.round(toFiniteNumber(summary?.totalReadings ?? summary?.total_readings))),
      totalEarnedFlow: toFiniteNumber(summary?.totalEarnedFlow ?? summary?.total_earned_flow, 4),
      todayEarnedFlow: toFiniteNumber(summary?.todayEarnedFlow ?? summary?.today_earned_flow, 4),
      avgDownload: toNullableNumber(summary?.avgDownload ?? summary?.avg_download, 1),
      avgUpload: toNullableNumber(summary?.avgUpload ?? summary?.avg_upload, 1),
      avgLatency: toNullableNumber(summary?.avgLatency ?? summary?.avg_latency, 0),
      confirmedReadings: Math.max(0, Math.round(toFiniteNumber(summary?.confirmedReadings ?? summary?.confirmed_readings))),
      pendingReadings: Math.max(0, Math.round(toFiniteNumber(summary?.pendingReadings ?? summary?.pending_readings))),
      failedReadings: Math.max(0, Math.round(toFiniteNumber(summary?.failedReadings ?? summary?.failed_readings))),
    },
    latestSession,
    sessions,
  };
}

export async function getMapperHistory(limit = 300): Promise<MapperHistoryResponse> {
  const res = await requestWithFallback(() => api.get('/api/mapper/history', { params: { limit }, timeout: 30000 }));
  return normalizeMapperHistory(res.data);
}

export async function login(email: string) {
  await healthCheck(15000);
  const res = await requestWithFallback(() => api.post('/api/auth/send-otp', { email }, { timeout: 20000 }));
  return res.data;
}

export async function verifyOtp(email: string, otp: string) {
  await healthCheck(15000);
  const res = await requestWithFallback(() => api.post('/api/auth/verify-otp', { email, code: otp, otp }, { timeout: 20000 }));
  return res.data;
}

export async function googleLogin(credential: string) {
  await healthCheck(15000);
  const res = await requestWithFallback(() => api.post('/api/auth/google', { credential }, { timeout: 20000 }));
  return res.data;
}

export async function exportPrivateKey() {
  const res = await requestWithFallback(() => api.get('/api/auth/export-key', { timeout: 20000 }));
  return res.data;
}

export async function faucet() {
  const res = await requestWithFallback(() => api.post('/api/faucet', {}, { timeout: 30000 }));
  return res.data;
}

export async function getCoverage(carrier?: string, technology?: string) {
  const params: any = {};
  if (carrier && carrier !== 'all') params.carrier = carrier;
  if (technology && technology !== 'all') params.technology = technology;
  const res = await requestWithFallback(() => api.get('/api/coverage', { params, timeout: 30000 }));
  return res.data;
}

export default api;
