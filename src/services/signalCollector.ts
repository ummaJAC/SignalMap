import * as Location from 'expo-location';
import * as NetInfo from '@react-native-community/netinfo';
import { PermissionsAndroid, Platform, NativeModules } from 'react-native';

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
  latencyMs: number | null;
  networkType: string | null;
  simOperator: string | null;
  networkOperator: string | null;
  mcc: string | null;
  mnc: string | null;
  cellId: number | string | null;
  tac: number | null;
  lac: number | null;
  pci: number | null;
  psc: number | null;
  rsrp: number | null;
  rsrq: number | null;
  sinr: number | null;
  asuLevel: number | null;
  dbm: number | null;
  isRegistered: boolean | null;
  wifiSsid: string | null;
  wifiBssid: string | null;
  wifiRssi: number | null;
  wifiLinkSpeedMbps: number | null;
  wifiFrequencyMhz: number | null;
  wifiIpAddress: string | null;
  telemetryRaw: Record<string, any>;
  accuracy: number;
  timestamp: number;
}

let locationSubscription: Location.LocationSubscription | null = null;

export async function requestPermissions(): Promise<boolean> {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') return false;
  if (Platform.OS === 'android') {
    const optionalPermissions = [
      PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      Platform.Version >= 33 ? 'android.permission.NEARBY_WIFI_DEVICES' : null,
    ].filter(Boolean) as typeof PermissionsAndroid.PERMISSIONS[keyof typeof PermissionsAndroid.PERMISSIONS][];

    try {
      await PermissionsAndroid.requestMultiple(optionalPermissions);
    } catch (error) {
      console.warn('Optional telemetry permission request failed:', error);
    }
  }
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
    let nativeTelemetry: Record<string, any> = {};

    if (Platform.OS === 'android' && CellularInfo) {
      try {
        const cellInfo = await CellularInfo.getCellularInfo();
        nativeTelemetry = cellInfo || {};
        if (cellInfo.carrier) carrier = cellInfo.carrier;
        if (cellInfo.networkOperatorName) carrier = cellInfo.networkOperatorName;
        if ((!carrier || carrier === 'Unknown') && cellInfo.simOperatorName) carrier = cellInfo.simOperatorName;
        if (cellInfo.technology && cellInfo.technology !== 'Unknown') technology = cellInfo.technology;
        if (cellInfo.cellularGeneration && cellInfo.cellularGeneration !== 'Unknown' && technology === 'Unknown') {
          technology = cellInfo.cellularGeneration;
        }
        if (cellInfo.signalDbm !== undefined) signalDbm = cellInfo.signalDbm;
        if (signalDbm == null && cellInfo.dbm !== undefined) signalDbm = cellInfo.dbm;
      } catch (e) {
        console.error('CellularInfo Error:', e);
        nativeTelemetry = { cellularError: String((e as any)?.message || e) };
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

    const qualityResult = await measureNetworkQuality();
    const telemetryRaw = {
      netInfo: {
        type: netInfo.type,
        isConnected: netInfo.isConnected,
        isInternetReachable: netInfo.isInternetReachable,
        details: netInfo.details,
      },
      native: nativeTelemetry,
      quality: qualityResult,
      collectedAt: new Date().toISOString(),
    };

    return {
      lat: loc.lat,
      lng: loc.lng,
      carrier,
      technology,
      signalDbm,
      wifiCount: netInfo.type === 'wifi' ? 1 : 0,
      speedDown: qualityResult.speedDown,
      speedUp: qualityResult.speedUp,
      speedSource: qualityResult.speedSource,
      speedError: qualityResult.speedError,
      latencyMs: qualityResult.latencyMs,
      networkType: nativeTelemetry.networkType || netInfo.type || null,
      simOperator: nativeTelemetry.simOperatorName || null,
      networkOperator: nativeTelemetry.networkOperatorName || carrier || null,
      mcc: nativeTelemetry.mcc || null,
      mnc: nativeTelemetry.mnc || null,
      cellId: nativeTelemetry.cellId ?? null,
      tac: nativeTelemetry.tac ?? null,
      lac: nativeTelemetry.lac ?? null,
      pci: nativeTelemetry.pci ?? null,
      psc: nativeTelemetry.psc ?? null,
      rsrp: nativeTelemetry.rsrp ?? null,
      rsrq: nativeTelemetry.rsrq ?? null,
      sinr: nativeTelemetry.sinr ?? nativeTelemetry.rssnr ?? null,
      asuLevel: nativeTelemetry.asuLevel ?? null,
      dbm: nativeTelemetry.dbm ?? signalDbm,
      isRegistered: nativeTelemetry.isRegistered ?? null,
      wifiSsid: nativeTelemetry.wifiSsid || null,
      wifiBssid: nativeTelemetry.wifiBssid || null,
      wifiRssi: nativeTelemetry.wifiRssi ?? null,
      wifiLinkSpeedMbps: nativeTelemetry.wifiLinkSpeedMbps ?? null,
      wifiFrequencyMhz: nativeTelemetry.wifiFrequencyMhz ?? null,
      wifiIpAddress: nativeTelemetry.wifiIpAddress || null,
      telemetryRaw,
      accuracy: loc.accuracy,
      timestamp: Date.now(),
    };
  } catch (err) {
    console.error('Signal collection error:', err);
    return null;
  }
}

async function measureNetworkQuality(): Promise<{
  speedDown: number | null;
  speedUp: number | null;
  latencyMs: number | null;
  speedSource: string | null;
  speedError: string | null;
}> {
  const latency = await measureLatencyMs('https://speed.cloudflare.com/cdn-cgi/trace');
  const download = await measureDownloadMbpsWithFallback();
  const upload = await measureUploadMbps();

  return {
    speedDown: download.speedDown,
    speedUp: upload.speedUp,
    latencyMs: latency.latencyMs,
    speedSource: [download.speedSource, upload.speedSource].filter(Boolean).join('+') || download.speedSource,
    speedError: [latency.error, download.speedError, upload.speedError].filter(Boolean).join('|') || null,
  };
}

async function measureLatencyMs(url: string): Promise<{ latencyMs: number | null; error: string | null }> {
  const startedAt = Date.now();
  try {
    const res = await fetch(`${url}?cacheBust=${Date.now()}`);
    if (!res.ok) return { latencyMs: null, error: `latency:http_${res.status}` };
    return { latencyMs: Date.now() - startedAt, error: null };
  } catch (error: any) {
    const message = String(error?.message || 'network_error').replace(/\s+/g, '_').toLowerCase();
    return { latencyMs: null, error: `latency:${message}` };
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

async function measureUploadMbps(): Promise<{
  speedUp: number | null;
  speedSource: string | null;
  speedError: string | null;
}> {
  const payload = 'signalmap-upload-probe-'.repeat(4096);
  const startedAt = Date.now();
  try {
    const res = await fetch(`https://speed.cloudflare.com/__up?cacheBust=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: payload,
    });
    if (!res.ok) {
      return { speedUp: null, speedSource: 'cloudflare-upload', speedError: `upload:http_${res.status}` };
    }
    const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
    const mbps = Math.round((payload.length * 8 / elapsedSeconds / 1_000_000) * 10) / 10;
    return { speedUp: mbps, speedSource: 'cloudflare-upload', speedError: null };
  } catch (error: any) {
    const message = String(error?.message || 'network_error').replace(/\s+/g, '_').toLowerCase();
    return { speedUp: null, speedSource: 'cloudflare-upload', speedError: `upload:${message}` };
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
