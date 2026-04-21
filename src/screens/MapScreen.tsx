import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  AppState,
} from 'react-native';
import Mapbox from '@rnmapbox/maps';
import * as NetInfo from '@react-native-community/netinfo';
import useMapperStore from '../store/useMapperStore';
import {
  collectBaseSignalData,
  measureNetworkQuality,
  mergeQualityIntoReading,
  requestPermissions,
  startLocationWatcher,
  stopLocationWatcher,
} from '../services/signalCollector';
import { sendReading, getMapperStats, getReadingStatus, updateReadingTelemetry, healthCheck } from '../services/api';
import {
  clearReadingUploadMark,
  isBackgroundMappingActive,
  markReadingUploaded,
  shouldUploadReading,
  startBackgroundMapping,
  stopBackgroundMapping,
} from '../services/backgroundMapping';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
const DEFAULT_CENTER = [30, 20];
const STYLE_URL = 'mapbox://styles/mapbox/streets-v12';
const SAMPLE_INTERVAL_MS = 30000;

type LocalMapReading = {
  id: string;
  lat: number;
  lng: number;
  signal: number | null;
  carrier?: string;
  technology?: string;
  transportType?: string;
  cellularTechnology?: string | null;
  signalDbm?: number | null;
  speedDown?: number | null;
  speedUp?: number | null;
  latencyMs?: number | null;
  speedSource?: string | null;
  speedError?: string | null;
  rsrp?: number | null;
  rsrq?: number | null;
  sinr?: number | null;
  pci?: number | null;
  cellId?: number | string | null;
  trustReceiptId?: number | null;
  bounty?: number;
  createdAt?: string;
};

type TelemetrySnapshot = {
  carrier?: string | null;
  networkOperator?: string | null;
  transportType?: string | null;
  networkType?: string | null;
  cellularTechnology?: string | null;
  signalDbm?: number | null;
  rsrp?: number | null;
  dbm?: number | null;
  speedDown?: number | null;
  speedUp?: number | null;
  latencyMs?: number | null;
};

export default function MapScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const {
    token,
    isMapping,
    setIsMapping,
    addReading,
    updateReading,
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
  const [mapVisualReady, setMapVisualReady] = useState(false);
  const [mappingStatus, setMappingStatus] = useState('Waiting for next sample');
  const [backgroundStatus, setBackgroundStatus] = useState<'unknown' | 'active' | 'foreground' | 'unavailable'>('unknown');
  const [selectedReading, setSelectedReading] = useState<LocalMapReading | null>(null);
  const [sessionStartBalance, setSessionStartBalance] = useState(0);
  const [sessionStartTotal, setSessionStartTotal] = useState(0);
  const [sessionAcceptedCount, setSessionAcceptedCount] = useState(0);
  const [telemetrySnapshot, setTelemetrySnapshot] = useState<TelemetrySnapshot | null>(null);
  const cameraRef = useRef<Mapbox.Camera>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasCenteredMapRef = useRef(false);
  const mountedRef = useRef(true);
  const sendingRef = useRef(false);
  const lastNetworkChangeRef = useRef(Date.now());
  const networkReachableRef = useRef<boolean | null>(null);
  const networkSignatureRef = useRef<string | null>(null);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const pollReadingUntilFinal = useCallback(async (readingId: string) => {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (!mountedRef.current) return;
      try {
        const statusRes = await getReadingStatus(readingId);
        const status = statusRes?.status;
        if (status === 'confirmed' || status === 'failed') {
          if (status === 'failed') {
            setMappingStatus('Backend failed');
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
    Mapbox.setAccessToken(MAPBOX_TOKEN)
      .then(() => {
        setMapReady(true);
        setMapVisualReady(false);
      })
      .catch((err: any) => {
        console.error('Mapbox setAccessToken failed:', err);
      });
  }, []);

  useEffect(() => {
    requestPermissions().then((ok) => {
      if (!ok) Alert.alert('Permission required', 'Location access needed to map coverage.');
    });
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      networkReachableRef.current = state.isInternetReachable;
      const signature = `${state.type}:${state.isConnected}:${state.isInternetReachable}`;
      if (networkSignatureRef.current && networkSignatureRef.current !== signature) {
        lastNetworkChangeRef.current = Date.now();
      }
      networkSignatureRef.current = signature;
    });

    NetInfo.fetch()
      .then((state) => {
        networkReachableRef.current = state.isInternetReachable;
        networkSignatureRef.current = `${state.type}:${state.isConnected}:${state.isInternetReachable}`;
      })
      .catch(() => {
        networkReachableRef.current = null;
      });

    return unsubscribe;
  }, []);

  const collectAndSend = useCallback(async (force = false) => {
    if (!token || sendingRef.current) return;
    if (!force && !(await shouldUploadReading(SAMPLE_INTERVAL_MS))) {
      setMappingStatus('Waiting for next sample');
      return;
    }
    if (networkReachableRef.current === false || Date.now() - lastNetworkChangeRef.current < 8000) {
      setMappingStatus('Network switching, retrying');
      return;
    }

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
      setTelemetrySnapshot((prev) => mergeTelemetrySnapshot(prev, data));
      setCenter([data.lng, data.lat]);
      if (!hasCenteredMapRef.current) {
        cameraRef.current?.setCamera({
          centerCoordinate: [data.lng, data.lat],
          zoomLevel: 14,
          animationDuration: 850,
        });
        hasCenteredMapRef.current = true;
      }

      setMappingStatus('Checking backend');
      await healthCheck(15000);

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
        const createdAt = new Date().toISOString();
        const reading: LocalMapReading = {
          id: readingId,
          lat: data.lat,
          lng: data.lng,
          signal: data.signalDbm ?? data.rsrp ?? data.dbm ?? null,
          carrier: data.carrier,
          technology: data.technology,
          transportType: data.transportType,
          cellularTechnology: data.cellularTechnology,
          signalDbm: data.signalDbm,
          speedDown: data.speedDown,
          speedUp: data.speedUp,
          latencyMs: data.latencyMs,
          speedSource: data.speedSource,
          speedError: data.speedError,
          rsrp: data.rsrp,
          rsrq: data.rsrq,
          sinr: data.sinr,
          pci: data.pci,
          cellId: data.cellId,
          trustReceiptId: result.trustReceipt?.id || null,
          bounty: result.bounty || 0,
          createdAt,
        };

        addReading({
          id: readingId,
          lat: data.lat,
          lng: data.lng,
          carrier: data.carrier,
          technology: data.technology,
          transportType: data.transportType,
          cellularTechnology: data.cellularTechnology,
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
          createdAt,
        });

        setReadings((prev) => [...prev, reading].slice(-200));
        setSessionAcceptedCount((prev) => prev + 1);
        setMappingStatus('Accepted, measuring speed');
        void markReadingUploaded();

        if (result.pending && result.readingId) {
          void pollReadingUntilFinal(String(result.readingId));
        }

        void measureNetworkQuality()
          .then(async (quality) => {
            if (!mountedRef.current) return;
            const enriched = mergeQualityIntoReading(data, quality);
            setLastKnownLocation(enriched);
            setTelemetrySnapshot((prev) => mergeTelemetrySnapshot(prev, enriched));
            const hasDownload = quality.speedDown != null;
            const hasLatency = quality.latencyMs != null;
            setMappingStatus(hasDownload ? 'Quality OK' : hasLatency ? 'Latency OK' : 'Speed probe failed');

            setReadings((prev) => prev.map((item) => (
              item.id === readingId
                ? {
                    ...item,
                    speedDown: quality.speedDown,
                    speedUp: quality.speedUp,
                    latencyMs: quality.latencyMs,
                    speedSource: quality.speedSource,
                    speedError: quality.speedError,
                  }
                : item
            )));

            updateReading(readingId, {
              speedDown: quality.speedDown,
              speedUp: quality.speedUp,
              latencyMs: quality.latencyMs,
              speedSource: quality.speedSource,
              speedError: quality.speedError,
              telemetryRaw: enriched.telemetryRaw,
            });

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
      const message = String((err as any)?.message || '').toLowerCase();
      if (message.includes('backend unreachable') || message.includes('network') || message.includes('timeout')) {
        setMappingStatus('Backend unreachable, retrying');
      } else {
        setMappingStatus('Upload failed');
        Alert.alert('Upload failed', 'Signal data was collected, but the backend did not accept it.');
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [addReading, pollReadingUntilFinal, setLastKnownLocation, token, updateReading]);

  useEffect(() => {
    if (isMapping) {
      setReadings([]);
      setSessionStartBalance(signalBalance);
      setSessionStartTotal(totalReadings);
      setSessionAcceptedCount(0);
      setTelemetrySnapshot(null);
      setMappingStatus('Collecting first sample');
      hasCenteredMapRef.current = false;
      void clearReadingUploadMark();

      startLocationWatcher((loc) => {
        setLastKnownLocation(loc);
        setCenter([loc.lng, loc.lat]);
        if (!hasCenteredMapRef.current) {
          cameraRef.current?.setCamera({
            centerCoordinate: [loc.lng, loc.lat],
            zoomLevel: 14,
            animationDuration: 850,
          });
          hasCenteredMapRef.current = true;
        }
      });

      void collectAndSend(true);
      if (appStateRef.current === 'active') {
        setBackgroundStatus('foreground');
        void stopBackgroundMapping().catch(() => {});
      } else {
        void startBackgroundMapping()
          .then((ok) => {
            setBackgroundStatus(ok ? 'active' : 'unavailable');
            if (!ok) setMappingStatus('Background permission unavailable');
          })
          .catch((err) => console.warn('Background mapping start failed:', err));
      }

      intervalRef.current = setInterval(() => void collectAndSend(), SAMPLE_INTERVAL_MS);
    } else {
      setMappingStatus('Waiting for next sample');
      setBackgroundStatus('unknown');
      setTelemetrySnapshot(lastKnownLocation || null);
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
  }, [collectAndSend, isMapping]);

  useEffect(() => {
    if (!isMapping) return;
    const iv = setInterval(() => {
      if (appStateRef.current === 'active') {
        setBackgroundStatus('foreground');
        return;
      }
      isBackgroundMappingActive()
        .then((active) => setBackgroundStatus(active ? 'active' : 'unavailable'))
        .catch(() => setBackgroundStatus('unknown'));
    }, 20000);
    return () => clearInterval(iv);
  }, [isMapping]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
      if (!isMapping) return;

      if (nextState === 'active') {
        setBackgroundStatus('foreground');
        void stopBackgroundMapping().catch((err) => console.warn('Background mapping stop failed:', err));
      } else {
        void startBackgroundMapping()
          .then((ok) => setBackgroundStatus(ok ? 'active' : 'unavailable'))
          .catch((err) => console.warn('Background mapping start failed:', err));
      }
    });

    return () => subscription.remove();
  }, [isMapping]);

  const fetchStats = useCallback(async () => {
    if (!token) return;
    try {
      const stats = await getMapperStats();
      setStats(stats);
    } catch {}
  }, [setStats, token]);

  useEffect(() => {
    if (!token) return;
    void fetchStats();
    const iv = setInterval(fetchStats, 15000);
    return () => clearInterval(iv);
  }, [token, fetchStats]);

  const rankLabel = totalReadings > 100 ? 'Gold Mapper' : totalReadings > 50 ? 'Silver Mapper' : totalReadings > 10 ? 'Bronze Mapper' : 'New Mapper';
  const lastReading = readings[readings.length - 1] || null;
  const hasUsableQuality = telemetrySnapshot?.speedDown != null || telemetrySnapshot?.latencyMs != null;
  const backendSessionReadings = Math.max(totalReadings - sessionStartTotal, 0);
  const sessionReadings = Math.max(backendSessionReadings, sessionAcceptedCount, isMapping ? 1 : 0);
  const sessionEarned = Math.max(signalBalance - sessionStartBalance, 0);
  const sessionDistanceMeters = useMemo(() => estimateDistanceMeters(readings), [readings]);
  const sessionCoverageKm = useMemo(() => estimateCoverageKm(readings), [readings]);
  const operatorValue = telemetrySnapshot?.carrier || telemetrySnapshot?.networkOperator || 'collecting...';
  const transportValue = formatTransportLabel(telemetrySnapshot);
  const signalValue = telemetrySnapshot?.signalDbm ?? telemetrySnapshot?.rsrp ?? telemetrySnapshot?.dbm ?? null;
  const signalLabel = signalValue != null ? `${signalValue} dBm` : 'n/a';
  const signalAccent = signalValue == null ? '#94A3B8' : signalValue > -85 ? '#12B59A' : signalValue > -105 ? '#F59E0B' : '#EF4444';
  const downLabel = telemetrySnapshot?.speedDown != null ? `${telemetrySnapshot.speedDown} Mbps` : 'n/a';
  const latencyLabel = telemetrySnapshot?.latencyMs != null ? `${telemetrySnapshot.latencyMs} ms` : 'n/a';
  const backgroundHint = backgroundStatus === 'active'
    ? 'Background tracking active'
    : backgroundStatus === 'foreground'
      ? 'Foreground tracking active'
      : backgroundStatus === 'unavailable'
        ? 'Background permission needed'
        : 'Background starting';
  const statusLabel = sending ? 'Sending' : mappingStatus;
  const statusAccent = hasUsableQuality ? '#12B59A' : sending ? '#F59E0B' : '#64748B';

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
        color: signalColor(r.signal),
        readingIndex: i,
      },
    })),
  };

  if (!mapReady) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#12B59A" />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <Mapbox.MapView
        style={styles.map}
        styleURL={STYLE_URL}
        onDidFinishLoadingStyle={() => setMapVisualReady(true)}
      >
        <Mapbox.Camera ref={cameraRef} centerCoordinate={center} zoomLevel={lastKnownLocation ? 12 : 2} />
        <Mapbox.UserLocation />
        {readings.length > 0 ? (
          <Mapbox.ShapeSource
            id="readings"
            shape={geojson}
            onPress={(event: any) => {
              const feature = event.features?.[0];
              const index = Number(feature?.properties?.readingIndex);
              if (!Number.isNaN(index) && readings[index]) setSelectedReading(readings[index]);
            }}
          >
            <Mapbox.CircleLayer
              id="readingCircles"
              style={{
                circleRadius: 8,
                circleColor: ['get', 'color'],
                circleOpacity: 0.85,
                circleStrokeWidth: 2,
                circleStrokeColor: '#FFFFFF',
              }}
            />
          </Mapbox.ShapeSource>
        ) : null}
      </Mapbox.MapView>

      {!mapVisualReady ? (
        <View style={styles.mapLoadingOverlay}>
          <ActivityIndicator size="small" color="#12B59A" />
          <Text style={styles.mapLoadingText}>Loading map...</Text>
        </View>
      ) : null}

      {mapVisualReady ? (
      <View style={styles.topStack} pointerEvents="box-none">
        <View style={styles.topRow}>
          <View style={styles.brandCard}>
            <View style={styles.brandIcon}>
              <Text style={styles.brandIconText}>S</Text>
            </View>
            <View style={styles.brandCopy}>
              <Text style={styles.logo}>SignalMap</Text>
              <Text style={styles.tagline}>{rankLabel}</Text>
            </View>
          </View>

          <View style={styles.earningsCard}>
            <Text style={styles.earningsLabel}>Earned</Text>
            <Text style={styles.earningsValue}>{signalBalance.toFixed(4)}</Text>
            <Text style={styles.earningsUnit}>FLOW</Text>
          </View>
        </View>

        {isMapping ? (
          <View style={styles.telemetryCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Live telemetry</Text>
              <TouchableOpacity
                onPress={() => lastReading && setSelectedReading(lastReading)}
                disabled={!lastReading}
                style={[styles.detailsPill, !lastReading && styles.detailsDisabled]}
              >
                <Text style={styles.detailsText}>Details</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.statusRow}>
              <View style={styles.sessionPill}>
                <View style={[styles.statusDot, { backgroundColor: statusAccent }]} />
                <Text style={styles.sessionPillText}>Session {sessionReadings} / Total {totalReadings}</Text>
              </View>
              <Text style={[styles.statusInline, { color: statusAccent }]}>{statusLabel}</Text>
            </View>

            <View style={styles.infoRow}>
              <InfoField label="Operator" value={operatorValue} />
              <InfoField label="Transport" value={transportValue} />
            </View>

            <View style={styles.metricsPanel}>
              <MetricField label="Signal" value={signalLabel} accent={signalAccent} bordered />
              <MetricField label="Down" value={downLabel} accent="#12B59A" bordered />
              <MetricField label="Latency" value={latencyLabel} accent="#0EA5E9" />
            </View>

            <Text style={styles.cardHint}>{backgroundHint}</Text>
          </View>
        ) : null}
      </View>
      ) : null}

      {mapVisualReady ? (
      <View style={[styles.bottomOverlay, { bottom: Math.max(tabBarHeight - 6, 62) }]}>
        {isMapping ? (
          <View style={styles.sessionStrip}>
            <Text style={styles.sessionStripText}>Session {sessionReadings}</Text>
            <Text style={styles.sessionStripDivider}>•</Text>
            <Text style={styles.sessionStripText}>{sessionEarned.toFixed(4)} FLOW</Text>
            <Text style={styles.sessionStripDivider}>•</Text>
            <Text style={styles.sessionStripText}>
              {backendSessionReadings === 0
                ? 'Syncing'
                : sessionDistanceMeters > 0
                ? formatDistance(sessionDistanceMeters)
                : sessionCoverageKm > 0
                  ? `${sessionCoverageKm.toFixed(2)} km2`
                  : 'Tracking'}
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.ctaButton, isMapping ? styles.stopButton : styles.startButton]}
          onPress={() => setIsMapping(!isMapping)}
          activeOpacity={0.84}
        >
          <Text style={styles.ctaText}>{isMapping ? 'STOP MAPPING' : 'START MAPPING'}</Text>
        </TouchableOpacity>
      </View>
      ) : null}

      <ReadingSheet reading={selectedReading} onClose={() => setSelectedReading(null)} />
    </SafeAreaView>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoField}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function MetricField({
  label,
  value,
  accent,
  bordered,
}: {
  label: string;
  value: string;
  accent: string;
  bordered?: boolean;
}) {
  return (
    <View style={[styles.metricField, bordered ? styles.metricFieldBordered : null]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color: accent }]}>{value}</Text>
    </View>
  );
}

function ReadingSheet({ reading, onClose }: { reading: LocalMapReading | null; onClose: () => void }) {
  return (
    <Modal visible={!!reading} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <View>
            <Text style={styles.sheetTitle}>Signal Reading</Text>
            <Text style={styles.sheetSub}>
              TX ID: {reading?.trustReceiptId ? `TrustReceipt #${reading.trustReceiptId}` : shortId(reading?.id)}
            </Text>
          </View>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>X</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sheetScoreRow}>
          <View style={styles.scoreCard}>
            <Text style={styles.scoreLabel}>QUALITY</Text>
            <Text style={[styles.scoreValue, { color: reading?.speedDown != null || reading?.latencyMs != null ? '#12B59A' : '#F59E0B' }]}>
              {reading?.speedDown != null ? 'Good' : reading?.latencyMs != null ? 'Fair' : 'Pending'}
            </Text>
          </View>
          <View style={styles.scoreCard}>
            <Text style={styles.scoreLabel}>STRENGTH</Text>
            <Text style={styles.scoreValue}>
              {reading?.signalDbm ?? reading?.signal ?? 'n/a'} <Text style={styles.scoreUnit}>dBm</Text>
            </Text>
          </View>
        </View>

        <ReadingDetail label="Operator" value={reading?.carrier || 'Unknown'} />
        <ReadingDetail label="Transport" value={reading?.transportType || reading?.technology || 'Unknown'} />
        <ReadingDetail label="Cellular tech" value={reading?.cellularTechnology || 'Unknown'} />
        <ReadingDetail label="Location" value={reading ? `${reading.lat.toFixed(4)}, ${reading.lng.toFixed(4)}` : 'n/a'} />
        <ReadingDetail label="Captured" value={reading?.createdAt ? new Date(reading.createdAt).toLocaleString() : 'n/a'} />

        <View style={styles.radioCard}>
          <Text style={styles.radioTitle}>EXTENDED RADIO METRICS</Text>
          {reading?.rsrp != null || reading?.rsrq != null || reading?.sinr != null || reading?.pci != null || reading?.cellId != null ? (
            <View style={styles.radioGrid}>
              <ReadingMini label="RSRP" value={reading?.rsrp != null ? `${reading.rsrp} dBm` : 'n/a'} />
              <ReadingMini label="RSRQ" value={reading?.rsrq != null ? `${reading.rsrq} dB` : 'n/a'} />
              <ReadingMini label="SINR" value={reading?.sinr != null ? `${reading.sinr} dB` : 'n/a'} />
              <ReadingMini label="PCI / CELL" value={`${reading?.pci ?? 'n/a'} / ${reading?.cellId ?? 'n/a'}`} />
            </View>
          ) : (
            <Text style={styles.radioUnavailable}>
              RF metrics unavailable on this Android device. The reading is still valid as GPS + operator + quality proof.
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

function shortId(value?: string | null) {
  if (!value) return 'pending';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function ReadingDetail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ReadingMini({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniMetric}>
      <Text style={styles.miniLabel}>{label}</Text>
      <Text style={styles.miniValue}>{value}</Text>
    </View>
  );
}

function mergeTelemetrySnapshot(previous: TelemetrySnapshot | null, next: Partial<TelemetrySnapshot> | null) {
  if (!previous) return next as TelemetrySnapshot | null;
  if (!next) return previous;
  return {
    carrier: next.carrier || next.networkOperator || previous.carrier || previous.networkOperator || null,
    networkOperator: next.networkOperator || previous.networkOperator || null,
    transportType: next.transportType || next.networkType || previous.transportType || previous.networkType || null,
    networkType: next.networkType || previous.networkType || null,
    cellularTechnology: next.cellularTechnology ?? previous.cellularTechnology ?? null,
    signalDbm: next.signalDbm ?? previous.signalDbm ?? null,
    rsrp: next.rsrp ?? previous.rsrp ?? null,
    dbm: next.dbm ?? previous.dbm ?? null,
    speedDown: next.speedDown ?? previous.speedDown ?? null,
    speedUp: next.speedUp ?? previous.speedUp ?? null,
    latencyMs: next.latencyMs ?? previous.latencyMs ?? null,
  };
}

function formatTransportLabel(snapshot: TelemetrySnapshot | null) {
  if (!snapshot) return 'collecting...';
  const base = snapshot.transportType || snapshot.networkType;
  const tech = snapshot.cellularTechnology;
  if (!base) return 'collecting...';
  if ((base === 'cellular' || base === 'cellular-vpn') && tech) return `${base.replace('-vpn', '')} (${tech})`;
  return base.replace('-vpn', ' + vpn');
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateDistanceMeters(items: LocalMapReading[]) {
  if (items.length < 2) return 0;
  const ordered = [...items].sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  let total = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    total += haversineMeters(ordered[i - 1].lat, ordered[i - 1].lng, ordered[i].lat, ordered[i].lng);
  }
  return Math.round(total);
}

function estimateCoverageKm(items: LocalMapReading[]) {
  if (!items.length) return 0;
  const lats = items.map((item) => item.lat);
  const lngs = items.map((item) => item.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const avgLat = (minLat + maxLat) / 2;
  const width = haversineMeters(avgLat, minLng, avgLat, maxLng);
  const height = haversineMeters(minLat, minLng, maxLat, minLng);
  return Number(((width * height) / 1000000).toFixed(2));
}

function formatDistance(meters: number) {
  if (!meters) return '0 m';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function signalColor(dbm: number | null) {
  if (dbm == null) return '#3B82F6';
  if (dbm > -70) return '#22C55E';
  if (dbm > -90) return '#FACC15';
  return '#EF4444';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#EEF7F2' },
  map: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 16, fontWeight: '700', color: '#64748B' },
  mapLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(238,247,242,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapLoadingText: { fontSize: 13, fontWeight: '800', color: '#174B46' },
  topStack: { position: 'absolute', top: 18, left: 12, right: 12, gap: 8 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  brandCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(247,255,251,0.88)',
    borderRadius: 22,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: 'rgba(205,239,229,0.94)',
    flex: 1,
  },
  brandIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: '#12B59A', alignItems: 'center', justifyContent: 'center' },
  brandIconText: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  brandCopy: { marginLeft: 10, flex: 1 },
  logo: { fontSize: 18, fontWeight: '900', color: '#174B46', letterSpacing: -0.4 },
  tagline: { fontSize: 10, fontWeight: '900', color: '#6E8782', marginTop: 2 },
  earningsCard: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 22,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minWidth: 92,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(210,234,226,0.95)',
  },
  earningsLabel: { fontSize: 9, fontWeight: '900', color: '#8AA59F', textTransform: 'uppercase', letterSpacing: 1 },
  earningsValue: { fontSize: 16, fontWeight: '900', color: '#174B46', marginTop: 4, letterSpacing: -0.3 },
  earningsUnit: { fontSize: 11, fontWeight: '900', color: '#12B59A', marginTop: 1 },
  telemetryCard: {
    width: '74%',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 24,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(210,234,226,0.95)',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 11, fontWeight: '900', color: '#12B59A', textTransform: 'uppercase', letterSpacing: 1 },
  detailsPill: { borderWidth: 1, borderColor: '#97E6DB', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#F7FFFD' },
  detailsDisabled: { opacity: 0.45 },
  detailsText: { fontSize: 10, fontWeight: '900', color: '#12B59A' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 8 },
  sessionPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: '#E2F0EA', flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  sessionPillText: { fontSize: 11, fontWeight: '900', color: '#174B46' },
  statusInline: { fontSize: 11, fontWeight: '900', textAlign: 'right', maxWidth: 84 },
  infoRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
  infoField: { flex: 1 },
  infoLabel: { fontSize: 9, fontWeight: '900', color: '#9AAEAA', letterSpacing: 0.7, textTransform: 'uppercase' },
  infoValue: { fontSize: 15, fontWeight: '900', color: '#174B46', marginTop: 4, textTransform: 'capitalize' },
  metricsPanel: { flexDirection: 'row', marginTop: 10, borderWidth: 1, borderColor: '#D8EEE6', borderRadius: 18, overflow: 'hidden', backgroundColor: '#FCFEFD' },
  metricField: { flex: 1, alignItems: 'center', paddingVertical: 9, paddingHorizontal: 4 },
  metricFieldBordered: { borderRightWidth: 1, borderRightColor: '#E2F0EA' },
  metricLabel: { fontSize: 9, fontWeight: '900', color: '#9AAEAA', letterSpacing: 0.7, textTransform: 'uppercase' },
  metricValue: { fontSize: 14, fontWeight: '900', marginTop: 5, textAlign: 'center' },
  cardHint: { marginTop: 8, fontSize: 10, fontWeight: '800', color: '#6E8782' },
  bottomOverlay: { position: 'absolute', left: 14, right: 14, gap: 6 },
  sessionStrip: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(252,254,253,0.82)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(220,238,231,0.78)',
    paddingHorizontal: 11,
    paddingVertical: 6,
    gap: 6,
  },
  sessionStripText: { fontSize: 10, fontWeight: '800', color: '#335C56' },
  sessionStripDivider: { fontSize: 9, fontWeight: '900', color: '#9EB7B0' },
  ctaButton: { borderRadius: 20, paddingVertical: 16, alignItems: 'center' },
  startButton: { backgroundColor: '#12B59A' },
  stopButton: { backgroundColor: '#F04E68' },
  ctaText: { fontSize: 17, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.8 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.42)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 28 },
  sheetHandle: { width: 52, height: 4, borderRadius: 999, backgroundColor: '#E2E8F0', alignSelf: 'center', marginBottom: 18 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  sheetTitle: { fontSize: 22, fontWeight: '900', color: '#174B46', letterSpacing: -0.4 },
  sheetSub: { fontSize: 12, fontWeight: '800', color: '#64748B', marginTop: 4 },
  closeButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 16, fontWeight: '900', color: '#64748B' },
  sheetScoreRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  scoreCard: { flex: 1, borderRadius: 18, padding: 15, backgroundColor: '#FAFAF9', borderWidth: 1, borderColor: '#E2E8F0' },
  scoreLabel: { fontSize: 10, fontWeight: '900', color: '#94A3B8', letterSpacing: 1 },
  scoreValue: { fontSize: 25, fontWeight: '900', color: '#3B82F6', marginTop: 7 },
  scoreUnit: { fontSize: 13, color: '#94A3B8' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  detailLabel: { fontSize: 13, fontWeight: '900', color: '#64748B' },
  detailValue: { flex: 1, textAlign: 'right', fontSize: 13, fontWeight: '900', color: '#0F172A' },
  radioCard: { marginTop: 16, borderRadius: 20, padding: 15, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
  radioTitle: { fontSize: 10, fontWeight: '900', color: '#64748B', letterSpacing: 1.1, marginBottom: 12 },
  radioGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  miniMetric: { width: '46%' },
  miniLabel: { fontSize: 10, fontWeight: '900', color: '#94A3B8' },
  miniValue: { fontSize: 13, fontWeight: '900', color: '#0F172A', marginTop: 4 },
  radioUnavailable: { fontSize: 12, fontWeight: '800', color: '#64748B', lineHeight: 18 },
});
