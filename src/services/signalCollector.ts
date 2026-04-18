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

    technology = netInfo.type?.toUpperCase() || technology;
    if (netInfo.type === 'cellular') {
      const cellType = (netInfo.details as any)?.cellularGeneration;
      if (cellType) {
        const techMap: Record<string, string> = {
          '1': '2G', '2': '3G', '3': '4G/LTE', '4': '5G',
        };
        technology = techMap[String(cellType)] || technology;
      }
    }

    return {
      lat: loc.lat,
      lng: loc.lng,
      carrier,
      technology,
      signalDbm,
      wifiCount: netInfo.type === 'wifi' ? 1 : 0,
      accuracy: loc.accuracy,
      timestamp: Date.now(),
    };
  } catch (err) {
    console.error('Signal collection error:', err);
    return null;
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
