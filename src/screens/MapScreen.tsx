import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, SafeAreaView,
  StatusBar, Alert, Platform, PermissionsAndroid, ActivityIndicator,
} from 'react-native';
import Mapbox from '@rnmapbox/maps';
import useMapperStore from '../store/useMapperStore';
import { collectSignalData, requestPermissions, startLocationWatcher, stopLocationWatcher } from '../services/signalCollector';
import { sendReading, getMapperStats } from '../services/api';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
const DEFAULT_CENTER = [121.4737, 31.2304];
const STYLE_URL = 'mapbox://styles/mapbox/streets-v12';

export default function MapScreen() {
  const { token, isMapping, setIsMapping, addReading, signalBalance, totalReadings, setBalances, setLastKnownLocation, lastKnownLocation } = useMapperStore();
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [readings, setReadings] = useState<any[]>([]);
  const [sending, setSending] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const cameraRef = useRef<Mapbox.Camera>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    Mapbox.setAccessToken(MAPBOX_TOKEN).then(() => {
      setMapReady(true);
    }).catch((err: any) => {
      console.error('Mapbox setAccessToken failed:', err);
    });
  }, []);

  useEffect(() => {
    requestPermissions().then((ok) => {
      if (!ok) Alert.alert('Permission required', 'Location access needed to map coverage.');
    });
  }, []);

  useEffect(() => {
    if (isMapping) {
      startLocationWatcher((loc) => {
        setLastKnownLocation(loc.lat, loc.lng);
        setCenter([loc.lng, loc.lat]);
        cameraRef.current?.setCamera({ centerCoordinate: [loc.lng, loc.lat], zoomLevel: 14, animationDuration: 500 });
      });

      intervalRef.current = setInterval(async () => {
        const data = await collectSignalData();
        if (!data || !token) return;

        setSending(true);
        try {
          const result = await sendReading({
            lat: data.lat,
            lng: data.lng,
            carrier: data.carrier,
            technology: data.technology,
            signalDbm: data.signalDbm,
            wifiCount: data.wifiCount,
          });

          if (result.success) {
            addReading({
              id: String(Date.now()),
              lat: data.lat,
              lng: data.lng,
              carrier: data.carrier,
              technology: data.technology,
              signalDbm: data.signalDbm,
              wifiCount: data.wifiCount,
              bounty: result.bounty,
              trustReceiptId: result.trustReceipt?.id || null,
              createdAt: new Date().toISOString(),
            });

            setReadings((prev) => [...prev, {
              lat: data.lat, lng: data.lng,
              signal: data.signalDbm || -100,
              carrier: data.carrier,
              technology: data.technology,
            }].slice(-200));
          }
        } catch (err) {
          console.error('Sending reading failed:', err);
        }
        setSending(false);
      }, 30000);
    } else {
      stopLocationWatcher();
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      stopLocationWatcher();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isMapping, token]);

  const fetchStats = useCallback(async () => {
    if (!token) return;
    try {
      const stats = await getMapperStats();
      setBalances(stats.signalBalance, parseFloat(stats.flowBalance));
    } catch {}
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchStats();
      const iv = setInterval(fetchStats, 15000);
      return () => clearInterval(iv);
    }
  }, [token, fetchStats]);

  const signalColor = (dbm: number) => {
    if (dbm > -70) return '#22C55E';
    if (dbm > -90) return '#FACC15';
    return '#EF4444';
  };

  const geojson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: readings.map((r, i) => ({
      type: 'Feature',
      id: String(i),
      geometry: {
        type: 'Point',
        coordinates: [r.lng, r.lat],
      },
      properties: {
        signal: r.signal,
        color: signalColor(r.signal),
      },
    })),
  };

  if (!mapReady) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#22C55E" />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <Mapbox.MapView style={styles.map} styleURL={STYLE_URL}>
        <Mapbox.Camera
          ref={cameraRef}
          centerCoordinate={center}
          zoomLevel={12}
        />
        <Mapbox.UserLocation />
        {readings.length > 0 && (
          <Mapbox.ShapeSource id="readings" shape={geojson}>
            <Mapbox.CircleLayer
              id="readingCircles"
              style={{
                circleRadius: 12,
                circleColor: ['get', 'color'],
                circleOpacity: 0.5,
                circleStrokeWidth: 1,
                circleStrokeColor: ['get', 'color'],
              }}
            />
          </Mapbox.ShapeSource>
        )}
      </Mapbox.MapView>

      <View style={styles.topBar}>
        <Text style={styles.logo}>📡 SignalMap</Text>
        <View style={styles.balanceBadge}>
          <Text style={styles.balanceText}>{signalBalance.toFixed(4)} FLOW</Text>
          <Text style={styles.readingsText}>{totalReadings} readings</Text>
        </View>
      </View>

      {isMapping && (
        <View style={styles.statusBar}>
          <View style={styles.pulseDot} />
          <Text style={styles.statusText}>
            MAPPING{sending ? ' • Sending...' : ''} • {readings.length} points
          </Text>
        </View>
      )}

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.mapButton, isMapping ? styles.stopButton : styles.startButton]}
          onPress={() => setIsMapping(!isMapping)}
          activeOpacity={0.8}
        >
          <Text style={styles.mapButtonText}>
            {isMapping ? '⏹ STOP MAPPING' : '📡 START MAPPING'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  map: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 16, fontWeight: '700', color: '#64748B' },
  topBar: {
    position: 'absolute', top: 50, left: 16, right: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  logo: { fontSize: 20, fontWeight: '900', color: '#1E293B' },
  balanceBadge: {
    backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  balanceText: { fontSize: 14, fontWeight: '800', color: '#22C55E' },
  readingsText: { fontSize: 10, fontWeight: '700', color: '#94A3B8' },
  statusBar: {
    position: 'absolute', top: 95, left: 16,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEF3C7', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4,
  },
  pulseDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: '#F59E0B',
  },
  statusText: { fontSize: 11, fontWeight: '700', color: '#92400E' },
  bottomBar: {
    position: 'absolute', bottom: 40, left: 16, right: 16,
  },
  mapButton: {
    borderRadius: 16, paddingVertical: 16, alignItems: 'center',
  },
  startButton: {
    backgroundColor: '#22C55E',
    shadowColor: '#15803D', shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  stopButton: {
    backgroundColor: '#EF4444',
    shadowColor: '#991B1B', shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  mapButtonText: { fontSize: 18, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },
});
