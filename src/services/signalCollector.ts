import * as Location from 'expo-location';
import * as NetInfo from '@react-native-community/netinfo';
import { Platform, NativeModules } from 'react-native';

const { CellularInfo } = NativeModules;

export interface RawSignalData {
  lat: number;
  lng: number;
  carrier: string;
  technology: string;
  signalDbm: number | null;
  wifiCount: number;
  speedDown: number | null;
  speedUp: number | null;
  speedSource: string | null;
  speedError: string | null;
  accuracy: number;
  timestamp: number;
}

let locationSubscription: Location.LocationSubscription | null = null;

export async function requestPermissions(): Promise<boolean> {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') return false;
  return true;
}

export async function getCurrentLocation(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return {
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      accuracy: loc.coords.accuracy || 100,
    };
  } catch {
    return null;
  }
}

export async function collectSignalData(): Promise<RawSignalData | null> {
  try {
    const loc = await getCurrentLocation();
    if (!loc) return null;

    const netInfo = await NetInfo.fetch();

    let carrier = 'Unknown';
    let technology = 'Unknown';
    let signalDbm: number | null = null;

    if (Platform.OS === 'android' && CellularInfo) {
      try {
        const cellInfo = await CellularInfo.getCellularInfo();
        if (cellInfo.carrier) carrier = cellInfo.carrier;
        if (cellInfo.technology && cellInfo.technology !== 'Unknown') technology = cellInfo.technology;
        if (cellInfo.signalDbm !== undefined) signalDbm = cellInfo.signalDbm;
      } catch (e) {
        console.error('CellularInfo Error:', e);
      }
    }

    if (netInfo.type === 'wifi') {
      technology = 'WiFi';
    } else if (netInfo.type === 'cellular') {
      const cellType = (netInfo.details as any)?.cellularGeneration;
      if (cellType) {
        const techMap: Record<string, string> = {
          '2g': '2G',
          '3g': '3G',
          '4g': '4G/LTE',
          '5g': '5G',
          '1': '2G',
          '2': '3G',
          '3': '4G/LTE',
          '4': '5G',
        };
        technology = techMap[String(cellType).toLowerCase()] || technology;
      }
    } else if (technology === 'Unknown' && netInfo.type) {
      technology = netInfo.type.toUpperCase();
    }

    const speedResult = await measureDownloadMbpsWithFallback();

    return {
      lat: loc.lat,
      lng: loc.lng,
      carrier,
      technology,
      signalDbm,
      wifiCount: netInfo.type === 'wifi' ? 1 : 0,
      speedDown: speedResult.speedDown,
      speedUp: null,
      speedSource: speedResult.speedSource,
      speedError: speedResult.speedError,
      accuracy: loc.accuracy,
      timestamp: Date.now(),
    };
  } catch (err) {
    console.error('Signal collection error:', err);
    return null;
  }
}

async function measureDownloadMbpsWithFallback(): Promise<{
  speedDown: number | null;
  speedSource: string | null;
  speedError: string | null;
}> {
  const probes = [
    { source: 'cloudflare', url: `https://speed.cloudflare.com/__down?bytes=200000&cacheBust=${Date.now()}` },
    { source: 'hetzner', url: `https://speed.hetzner.de/1MB.bin?cacheBust=${Date.now()}` },
  ];

  let lastError: string | null = null;
  for (const probe of probes) {
    const result = await measureProbeMbps(probe.source, probe.url);
    if (result.speedDown != null) return result;
    lastError = result.speedError;
  }

  return { speedDown: null, speedSource: null, speedError: lastError || 'all_speed_probes_failed' };
}

async function measureProbeMbps(source: string, url: string): Promise<{
  speedDown: number | null;
  speedSource: string | null;
  speedError: string | null;
}> {
  const startedAt = Date.now();
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { speedDown: null, speedSource: source, speedError: `${source}:http_${res.status}` };
    }

    const blob = await res.blob();
    if (!blob || blob.size <= 0) {
      return { speedDown: null, speedSource: source, speedError: `${source}:empty_payload` };
    }

    const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
    const mbps = Math.round((blob.size * 8 / elapsedSeconds / 1_000_000) * 10) / 10;
    return { speedDown: mbps, speedSource: source, speedError: null };
  } catch (error: any) {
    const message = String(error?.message || 'network_error').replace(/\s+/g, '_').toLowerCase();
    return { speedDown: null, speedSource: source, speedError: `${source}:${message}` };
  }
}

export function startLocationWatcher(
  callback: (loc: { lat: number; lng: number }) => void
): void {
  Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, distanceInterval: 20, timeInterval: 5000 },
    (loc) => {
      callback({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    }
  ).then((sub) => {
    locationSubscription = sub;
  }).catch(console.error);
}

export function stopLocationWatcher(): void {
  if (locationSubscription) {
    locationSubscription.remove();
    locationSubscription = null;
  }
}
