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
  bounty: number;
  trustReceiptId: number | null;
  createdAt: string;
}

interface MapperState {
  token: string | null;
  evmAddress: string | null;
  isMapping: boolean;
  readings: SignalReading[];
  totalReadings: number;
  signalBalance: number;
  flowBalance: number;
  lastKnownLocation: { lat: number; lng: number } | null;

  setToken: (token: string) => void;
  setEvmAddress: (addr: string) => void;
  setIsMapping: (val: boolean) => void;
  addReading: (r: SignalReading) => void;
  setBalances: (signal: number, flow: number) => void;
  setLastKnownLocation: (lat: number, lng: number) => void;
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
      setLastKnownLocation: (lat, lng) => set({ lastKnownLocation: { lat, lng } }),
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
