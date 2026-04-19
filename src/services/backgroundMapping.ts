import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { collectBaseSignalDataForLocation } from './signalCollector';
import { sendReading, setAuthToken } from './api';

export const SIGNALMAP_BACKGROUND_LOCATION_TASK = 'SIGNALMAP_BACKGROUND_LOCATION_TASK';

async function getPersistedToken(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem('signalmap-state');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const token = parsed?.state?.token || parsed?.token || null;
    return token && !String(token).startsWith('dev-token-') ? token : null;
  } catch {
    return null;
  }
}

TaskManager.defineTask(SIGNALMAP_BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('SignalMap background location error:', error);
    return;
  }

  const locations = (data as any)?.locations as Location.LocationObject[] | undefined;
  const latest = locations?.[locations.length - 1];
  if (!latest) return;

  const token = await getPersistedToken();
  if (!token) return;
  setAuthToken(token);

  const reading = await collectBaseSignalDataForLocation({
    lat: latest.coords.latitude,
    lng: latest.coords.longitude,
    accuracy: latest.coords.accuracy || 100,
  });
  if (!reading) return;

  try {
    await sendReading(reading);
    console.log(`Background reading uploaded @ ${reading.lat.toFixed(4)},${reading.lng.toFixed(4)}`);
  } catch (err) {
    console.warn('Background reading upload failed:', err);
  }
});

export async function startBackgroundMapping(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return false;

  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(SIGNALMAP_BACKGROUND_LOCATION_TASK);
  if (alreadyStarted) return true;

  await Location.startLocationUpdatesAsync(SIGNALMAP_BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 30000,
    distanceInterval: 25,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'SignalMap is mapping coverage',
      notificationBody: 'Collecting DePIN network readings',
      notificationColor: '#22C55E',
    },
  });

  return true;
}

export async function stopBackgroundMapping(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(SIGNALMAP_BACKGROUND_LOCATION_TASK);
  if (started) {
    await Location.stopLocationUpdatesAsync(SIGNALMAP_BACKGROUND_LOCATION_TASK);
  }
}
