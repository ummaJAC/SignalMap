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
