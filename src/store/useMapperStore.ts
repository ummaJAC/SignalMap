import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface SignalReading {
  id: string;
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
  bounty: number;
  trustReceiptId: number | null;
  createdAt: string;
}

interface LastKnownLocation {
  lat: number;
  lng: number;
  carrier?: string;
  technology?: string;
  signalDbm?: number | null;
  wifiCount?: number;
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
  accuracy?: number;
  timestamp?: number;
}

interface LastReward {
  id?: string;
  reward_tx_hash?: string | null;
  reward_status?: string | null;
  reward_error?: string | null;
  created_at?: string;
}

interface MapperState {
  token: string | null;
  email: string | null;
  username: string | null;
  evmAddress: string | null;
  isMapping: boolean;
  readings: SignalReading[];
  totalReadings: number;
  signalBalance: number;
  flowBalance: number;
  confirmedReadings: number;
  pendingReadings: number;
  failedReadings: number;
  pendingRewards: number;
  failedRewards: number;
  lastReward: LastReward | null;
  lastKnownLocation: LastKnownLocation | null;

  setToken: (token: string | null) => void;
  setUser: (user: { email?: string | null; username?: string | null; evm_address?: string | null; evmAddress?: string | null }) => void;
  setEvmAddress: (addr: string | null) => void;
  setIsMapping: (val: boolean) => void;
  addReading: (r: SignalReading) => void;
  setBalances: (signal: number, flow: number) => void;
  setStats: (stats: {
    signalBalance?: number;
    flowBalance?: string | number;
    readings?: number;
    confirmedReadings?: number;
    pendingReadings?: number;
    failedReadings?: number;
    pendingRewards?: number;
    failedRewards?: number;
    evmAddress?: string | null;
    lastReward?: LastReward | null;
  }) => void;
  setLastKnownLocation: (loc: LastKnownLocation) => void;
  reset: () => void;
}

const initialState = {
  token: null,
  email: null,
  username: null,
  evmAddress: null,
  isMapping: false,
  readings: [] as SignalReading[],
  totalReadings: 0,
  signalBalance: 0,
  flowBalance: 0,
  confirmedReadings: 0,
  pendingReadings: 0,
  failedReadings: 0,
  pendingRewards: 0,
  failedRewards: 0,
  lastReward: null as LastReward | null,
  lastKnownLocation: null as LastKnownLocation | null,
};

const useMapperStore = create<MapperState>()(
  persist(
    (set) => ({
      ...initialState,

      setToken: (token) => set({ token }),
      setUser: (user) => set({
        email: user.email ?? null,
        username: user.username ?? null,
        evmAddress: user.evm_address ?? user.evmAddress ?? null,
      }),
      setEvmAddress: (evmAddress) => set({ evmAddress }),
      setIsMapping: (isMapping) => set({ isMapping }),
      addReading: (r) => set((s) => ({
        readings: [r, ...s.readings].slice(0, 100),
      })),
      setBalances: (signalBalance, flowBalance) => set({ signalBalance, flowBalance }),
      setStats: (stats) => set((s) => ({
        signalBalance: stats.signalBalance ?? s.signalBalance,
        flowBalance: stats.flowBalance != null ? parseFloat(String(stats.flowBalance)) : s.flowBalance,
        totalReadings: stats.readings ?? s.totalReadings,
        confirmedReadings: stats.confirmedReadings ?? s.confirmedReadings,
        pendingReadings: stats.pendingReadings ?? s.pendingReadings,
        failedReadings: stats.failedReadings ?? s.failedReadings,
        pendingRewards: stats.pendingRewards ?? s.pendingRewards,
        failedRewards: stats.failedRewards ?? s.failedRewards,
        evmAddress: stats.evmAddress ?? s.evmAddress,
        lastReward: Object.prototype.hasOwnProperty.call(stats, 'lastReward') ? (stats.lastReward ?? null) : s.lastReward,
      })),
      setLastKnownLocation: (lastKnownLocation) => set({ lastKnownLocation }),
      reset: () => set({ ...initialState }),
    }),
    {
      name: 'signalmap-state',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      migrate: (persisted: any) => {
        if (!persisted) return initialState;
        if (persisted?.state?.token?.startsWith?.('dev-token-')) return initialState;
        return persisted.state || persisted;
      },
    }
  )
);

export default useMapperStore;
