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

interface MapperState {
  token: string | null;
  evmAddress: string | null;
  isMapping: boolean;
  readings: SignalReading[];
  totalReadings: number;
  signalBalance: number;
  flowBalance: number;
  lastKnownLocation: LastKnownLocation | null;

  setToken: (token: string) => void;
  setEvmAddress: (addr: string) => void;
  setIsMapping: (val: boolean) => void;
  addReading: (r: SignalReading) => void;
  setBalances: (signal: number, flow: number) => void;
  setLastKnownLocation: (loc: LastKnownLocation) => void;
  reset: () => void;
}

const useMapperStore = create<MapperState>()(
  persist(
    (set) => ({
      token: 'dev-token-hackathon-2026',
      evmAddress: null,
      isMapping: false,
      readings: [],
      totalReadings: 0,
      signalBalance: 0,
      flowBalance: 0,
      lastKnownLocation: null,

      setToken: (token) => set({ token }),
      setEvmAddress: (evmAddress) => set({ evmAddress }),
      setIsMapping: (isMapping) => set({ isMapping }),
      addReading: (r) => set((s) => ({
        readings: [r, ...s.readings].slice(0, 100),
        totalReadings: s.totalReadings + 1,
        signalBalance: s.signalBalance + r.bounty,
      })),
      setBalances: (signalBalance, flowBalance) => set({ signalBalance, flowBalance }),
      setLastKnownLocation: (lastKnownLocation) => set({ lastKnownLocation }),
      reset: () => set({
        token: null, evmAddress: null, isMapping: false,
        readings: [], totalReadings: 0, signalBalance: 0, flowBalance: 0,
      }),
    }),
    { 
      name: 'signalmap-state',
      storage: createJSONStorage(() => AsyncStorage)
    }
  )
);

export default useMapperStore;
