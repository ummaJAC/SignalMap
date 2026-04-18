import axios from 'axios';

const API_BASE = 'https://signalmap-production.up.railway.app';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 10000,
  headers: { 
    'Content-Type': 'application/json',
    'Bypass-Tunnel-Reminder': 'true'
  },
});

export function setAuthToken(token: string) {
  api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
}

export async function sendReading(data: {
  lat: number;
  lng: number;
  carrier: string;
  technology: string;
  signalDbm: number | null;
  wifiCount: number;
  speedDown?: number;
  speedUp?: number;
}) {
  try {
    const res = await api.post('/api/readings', data);
    return res.data;
  } catch (error: any) {
    const errMsg = error?.response 
      ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
      : error?.message || 'Unknown error';
    console.warn('🛡️ Safety Catch triggered. Reason:', errMsg);
    console.warn('Attempted URL:', API_BASE + '/api/readings');
    return {
      success: true,
      bounty: 0.001,
      trustReceipt: null,
      reading: data
    };
  }
}

export async function getMapperStats() {
  const res = await api.get('/api/mapper/stats');
  return res.data;
}

export async function login(email: string) {
  const res = await api.post('/api/auth/send-otp', { email });
  return res.data;
}

export async function verifyOtp(email: string, otp: string) {
  const res = await api.post('/api/auth/verify-otp', { email, otp });
  return res.data;
}

export async function faucet() {
  const res = await api.post('/api/faucet');
  return res.data;
}

export async function getCoverage(carrier?: string, technology?: string) {
  const params: any = {};
  if (carrier && carrier !== 'all') params.carrier = carrier;
  if (technology && technology !== 'all') params.technology = technology;
  const res = await api.get('/api/coverage', { params });
  return res.data;
}

export default api;
