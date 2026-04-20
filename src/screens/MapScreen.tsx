import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, SafeAreaView,
  StatusBar, Alert, ActivityIndicator,
} from 'react-native';
import Mapbox from '@rnmapbox/maps';
import useMapperStore from '../store/useMapperStore';
import {
  collectBaseSignalData,
  measureNetworkQuality,
  mergeQualityIntoReading,
  requestPermissions,
  startLocationWatcher,
  stopLocationWatcher,
} from '../services/signalCollector';
import { sendReading, getMapperStats, getReadingStatus, updateReadingTelemetry } from '../services/api';
import { startBackgroundMapping, stopBackgroundMapping } from '../services/backgroundMapping';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
const DEFAULT_CENTER = [121.4737, 31.2304];
const STYLE_URL = 'mapbox://styles/mapbox/streets-v12';

type LocalMapReading = {
  lat: number;
  lng: number;
  signal: number;
  carrier?: string;
  technology?: string;
};

export default function MapScreen() {
  const {
    token,
    isMapping,
    setIsMapping,
    addReading,
    signalBalance,
    totalReadings,
    setStats,
    setLastKnownLocation,
    lastKnownLocation,
  } = useMapperStore();

  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [readings, setReadings] = useState<LocalMapReading[]>([]);
  const [sending, setSending] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mappingStatus, setMappingStatus] = useState('Waiting for next sample');
  const cameraRef = useRef<Mapbox.Camera>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const sendingRef = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const pollReadingUntilFinal = useCallback(async (readingId: string) => {
    for (let attempt = 0; attempt < 24; attempt++) {
      if (!mountedRef.current) return;
      try {
        const statusRes = await getReadingStatus(readingId);
        const status = statusRes?.status;
        if (status === 'confirmed' || status === 'failed') {
          if (status === 'failed') {
            setMappingStatus('Backend failed');
            console.warn(`Reading ${readingId} failed in backend: ${statusRes?.errorMessage || 'unknown'}`);
          } else {
            setMappingStatus(statusRes?.rewardStatus === 'paid' ? 'Confirmed + reward paid' : 'Confirmed');
            try {
              const stats = await getMapperStats();
              setStats(stats);
            } catch {}
          }
          return;
        }
      } catch (err) {
        console.warn(`Reading status poll error for ${readingId}:`, err);
      }
      await sleep(5000);
    }
  }, [setStats]);

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

  const collectAndSend = useCallback(async () => {
    if (!token || sendingRef.current) return;

    sendingRef.current = true;
    setSending(true);
    setMappingStatus('Collecting GPS');

    try {
      const data = await collectBaseSignalData();
      if (!data) {
        setMappingStatus('GPS unavailable');
        return;
      }

      setLastKnownLocation(data);
      setCenter([data.lng, data.lat]);
      cameraRef.current?.setCamera({
        centerCoordinate: [data.lng, data.lat],
        zoomLevel: 14,
        animationDuration: 500,
      });

      setMappingStatus('Uploading reading');
      const result = await sendReading({
        lat: data.lat,
        lng: data.lng,
        carrier: data.carrier,
        technology: data.technology,
        signalDbm: data.signalDbm,
        wifiCount: data.wifiCount,
        speedDown: data.speedDown,
        speedUp: data.speedUp,
        speedSource: data.speedSource,
        speedError: data.speedError,
        latencyMs: data.latencyMs,
        networkType: data.networkType,
        simOperator: data.simOperator,
        networkOperator: data.networkOperator,
        mcc: data.mcc,
        mnc: data.mnc,
        cellId: data.cellId,
        tac: data.tac,
        lac: data.lac,
        pci: data.pci,
        psc: data.psc,
        rsrp: data.rsrp,
        rsrq: data.rsrq,
        sinr: data.sinr,
        asuLevel: data.asuLevel,
        dbm: data.dbm,
        isRegistered: data.isRegistered,
        wifiSsid: data.wifiSsid,
        wifiBssid: data.wifiBssid,
        wifiRssi: data.wifiRssi,
        wifiLinkSpeedMbps: data.wifiLinkSpeedMbps,
        wifiFrequencyMhz: data.wifiFrequencyMhz,
        wifiIpAddress: data.wifiIpAddress,
        telemetryRaw: data.telemetryRaw,
      });

      if (result.success) {
        const readingId = String(result.readingId || result.reading?.id || Date.now());

        addReading({
          id: readingId,
          lat: data.lat,
          lng: data.lng,
          carrier: data.carrier,
          technology: data.technology,
          signalDbm: data.signalDbm,
          wifiCount: data.wifiCount,
          speedDown: data.speedDown,
          speedUp: data.speedUp,
          speedSource: data.speedSource,
          speedError: data.speedError,
          latencyMs: data.latencyMs,
          networkType: data.networkType,
          simOperator: data.simOperator,
          networkOperator: data.networkOperator,
          mcc: data.mcc,
          mnc: data.mnc,
          cellId: data.cellId,
          tac: data.tac,
          lac: data.lac,
          pci: data.pci,
          psc: data.psc,
          rsrp: data.rsrp,
          rsrq: data.rsrq,
          sinr: data.sinr,
          asuLevel: data.asuLevel,
          dbm: data.dbm,
          isRegistered: data.isRegistered,
          wifiSsid: data.wifiSsid,
          wifiBssid: data.wifiBssid,
          wifiRssi: data.wifiRssi,
          wifiLinkSpeedMbps: data.wifiLinkSpeedMbps,
          wifiFrequencyMhz: data.wifiFrequencyMhz,
          wifiIpAddress: data.wifiIpAddress,
          telemetryRaw: data.telemetryRaw,
          bounty: result.bounty || 0,
          trustReceiptId: result.trustReceipt?.id || null,
          createdAt: new Date().toISOString(),
        });

        setReadings((prev) => [...prev, {
          lat: data.lat,
          lng: data.lng,
          signal: data.signalDbm || data.rsrp || data.dbm || -100,
          carrier: data.carrier,
          technology: data.technology,
        }].slice(-200));

        setMappingStatus('Accepted, measuring speed');
        if (result.pending && result.readingId) {
          void pollReadingUntilFinal(String(result.readingId));
        }

        void measureNetworkQuality()
          .then(async (quality) => {
            if (!mountedRef.current) return;
            const enriched = mergeQualityIntoReading(data, quality);
            setLastKnownLocation(enriched);
            const hasUsableQuality = quality.speedDown != null || quality.latencyMs != null;
            setMappingStatus(hasUsableQuality ? 'Quality OK' : 'Speed probe failed');

            if (result.readingId) {
              try {
                await updateReadingTelemetry(String(result.readingId), {
                  speedDown: quality.speedDown,
                  speedUp: quality.speedUp,
                  speedSource: quality.speedSource,
                  speedError: quality.speedError,
                  latencyMs: quality.latencyMs,
                  telemetryRaw: enriched.telemetryRaw,
                });
              } catch (err) {
                console.warn(`Reading telemetry update failed for ${result.readingId}:`, err);
              }
            }
          })
          .catch((err) => {
            console.warn('Network quality probe failed:', err);
            setMappingStatus('Speed probe failed');
          });
      }
    } catch (err) {
      console.error('Sending reading failed:', err);
      setMappingStatus('Upload failed');
      Alert.alert('Upload failed', 'Signal data was collected, but the backend did not accept it.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [addReading, pollReadingUntilFinal, setLastKnownLocation, token]);

  useEffect(() => {
    if (isMapping) {
      setMappingStatus('Waiting for next sample');
      startLocationWatcher((loc) => {
        setLastKnownLocation(loc);
        setCenter([loc.lng, loc.lat]);
        cameraRef.current?.setCamera({
          centerCoordinate: [loc.lng, loc.lat],
          zoomLevel: 14,
          animationDuration: 500,
        });
      });

      void collectAndSend();
      void startBackgroundMapping().then((ok) => {
        if (!ok) {
          console.warn('Background mapping permission unavailable. Foreground mapping still active.');
        }
      }).catch((err) => console.warn('Background mapping start failed:', err));
      intervalRef.current = setInterval(() => void collectAndSend(), 30000);
    } else {
      setMappingStatus('Waiting for next sample');
      stopLocationWatcher();
      void stopBackgroundMapping().catch((err) => console.warn('Background mapping stop failed:', err));
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      stopLocationWatcher();
      void stopBackgroundMapping().catch(() => {});
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [collectAndSend, isMapping, setLastKnownLocation]);

  const fetchStats = useCallback(async () => {
    if (!token) return;
    try {
      const stats = await getMapperStats();
      setStats(stats);
    } catch {}
  }, [setStats, token]);

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

  const hasUsableQuality = lastKnownLocation?.speedDown != null || lastKnownLocation?.latencyMs != null;

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
        <Text style={styles.logo}>SignalMap</Text>
        <View style={styles.balanceBadge}>
          <Text style={styles.balanceText}>{signalBalance.toFixed(4)} FLOW</Text>
          <Text style={styles.readingsText}>{totalReadings} readings</Text>
        </View>
      </View>

      {isMapping && (
        <>
          <View style={styles.statusBar}>
            <View style={styles.pulseDot} />
            <Text style={styles.statusText}>
              SESSION {readings.length} / TOTAL {totalReadings}{sending ? ' - Sending...' : ''}
            </Text>
          </View>

          <View style={styles.debugBar}>
            <Text style={styles.debugText}>{mappingStatus}</Text>
          </View>

          {lastKnownLocation?.carrier && (
            <View style={styles.telemetryHud}>
              <Text style={styles.hudTitle}>LIVE TELEMETRY</Text>
              <View style={styles.hudRow}>
                <Text style={styles.hudLabel}>OPERATOR</Text>
                <Text style={styles.hudValue}>{lastKnownLocation.carrier}</Text>
              </View>
              <View style={styles.hudRow}>
                <Text style={styles.hudLabel}>NETWORK TECH</Text>
                <Text style={styles.hudValue}>{lastKnownLocation.technology || 'LTE'}</Text>
              </View>
              {lastKnownLocation.wifiSsid ? (
                <View style={styles.hudRow}>
                  <Text style={styles.hudLabel}>WI-FI SSID</Text>
                  <Text style={styles.hudValue}>{lastKnownLocation.wifiSsid}</Text>
                </View>
              ) : null}
              <View style={styles.hudRow}>
                <Text style={styles.hudLabel}>SIGNAL STRENGTH</Text>
                <Text style={[
                  styles.hudValue,
                  { color: (lastKnownLocation.signalDbm ?? -120) > -85 ? '#10B981' : ((lastKnownLocation.signalDbm ?? -120) > -105 ? '#F59E0B' : '#EF4444') },
                ]}>
                  {lastKnownLocation.signalDbm ?? 'n/a'} dBm
                </Text>
              </View>
              {(lastKnownLocation.rsrp != null || lastKnownLocation.sinr != null) ? (
                <View style={styles.hudRow}>
                  <Text style={styles.hudLabel}>RADIO QUALITY</Text>
                  <Text style={styles.hudValue}>
                    RSRP {lastKnownLocation.rsrp ?? 'n/a'} / SINR {lastKnownLocation.sinr ?? 'n/a'}
                  </Text>
                </View>
              ) : null}
              <View style={styles.hudRow}>
                <Text style={styles.hudLabel}>DOWNLOAD SAMPLE</Text>
                <Text style={styles.hudValue}>
                  {lastKnownLocation.speedDown != null ? `${lastKnownLocation.speedDown} Mbps` : 'n/a'}
                </Text>
              </View>
              <View style={styles.hudRow}>
                <Text style={styles.hudLabel}>LATENCY</Text>
                <Text style={styles.hudValue}>
                  {lastKnownLocation.latencyMs != null ? `${lastKnownLocation.latencyMs} ms` : 'n/a'}
                </Text>
              </View>
              <View style={styles.hudRow}>
                <Text style={styles.hudLabel}>UPLOAD SAMPLE</Text>
                <Text style={styles.hudValue}>
                  {lastKnownLocation.speedUp != null ? `${lastKnownLocation.speedUp} Mbps` : 'n/a'}
                </Text>
              </View>
              {lastKnownLocation.speedError && !hasUsableQuality ? (
                <View style={styles.hudRow}>
                  <Text style={styles.hudLabel}>SPEED ERROR</Text>
                  <Text style={[styles.hudValue, { color: '#B91C1C', fontSize: 11 }]}>
                    {lastKnownLocation.speedError}
                  </Text>
                </View>
              ) : null}
              <Text style={styles.hintText}>
                Huawei/Honor: allow unrestricted battery for background mapping.
              </Text>
            </View>
          )}
        </>
      )}

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.mapButton, isMapping ? styles.stopButton : styles.startButton]}
          onPress={() => setIsMapping(!isMapping)}
          activeOpacity={0.8}
        >
          <Text style={styles.mapButtonText}>
            {isMapping ? 'STOP MAPPING' : 'START MAPPING'}
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
  debugBar: {
    position: 'absolute', top: 124, left: 16,
    backgroundColor: 'rgba(15,23,42,0.72)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4,
  },
  debugText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF' },
  telemetryHud: {
    position: 'absolute', top: 155, left: 16, width: 200,
    backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#E2E8F0',
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, elevation: 4,
  },
  hudTitle: { fontSize: 10, fontWeight: '800', color: '#64748B', marginBottom: 12, letterSpacing: 0.5 },
  hudRow: { marginBottom: 8 },
  hudLabel: { fontSize: 9, fontWeight: '700', color: '#94A3B8', marginBottom: 2 },
  hudValue: { fontSize: 13, fontWeight: '900', color: '#0F172A' },
  hintText: { fontSize: 9, fontWeight: '700', color: '#64748B', lineHeight: 13, marginTop: 2 },
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
