import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import useMapperStore from '../store/useMapperStore';
import { getMapperHistory, MapperHistorySession } from '../services/api';

type HistoryData = Awaited<ReturnType<typeof getMapperHistory>>;

type SessionView = MapperHistorySession;

const SESSION_GAP_MS = 20 * 60 * 1000;

export default function HistoryScreen() {
  const {
    token,
    email,
    username,
    readings,
    signalBalance,
    totalReadings,
    confirmedReadings,
    pendingReadings,
    failedReadings,
    isMapping,
  } = useMapperStore();
  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isFocused = useIsFocused();
  const previousMappingRef = useRef(isMapping);
  const lastRefreshSignatureRef = useRef<string | null>(null);

  const fallbackSessions = useMemo(() => buildLocalSessions(readings, {
    signalBalance,
    totalReadings,
    confirmedReadings,
    pendingReadings,
    failedReadings,
    isMapping,
  }), [confirmedReadings, failedReadings, isMapping, pendingReadings, readings, signalBalance, totalReadings]);

  const load = useCallback(async (showSpinner = false) => {
    if (!token) {
      setData(null);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const res = await getMapperHistory(300);
      setData(res);
      setExpanded((prev) => {
        const next = { ...prev };
        const firstId = res.latestSession?.sessionId || res.sessions?.[0]?.sessionId;
        if (firstId && next[firstId] == null) next[firstId] = true;
        return next;
      });
    } catch (err: any) {
      console.warn('Mapper history load failed:', err);
      setData(null);
      setError(String(err?.message || 'History sync failed.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load])
  );

  useEffect(() => {
    if (!token || !isFocused) return;

    const stoppedMapping = previousMappingRef.current && !isMapping;
    previousMappingRef.current = isMapping;
    const signature = [
      confirmedReadings,
      pendingReadings,
      failedReadings,
      totalReadings,
      signalBalance.toFixed(4),
      stoppedMapping ? 'stopped' : 'steady',
    ].join(':');

    if (lastRefreshSignatureRef.current === signature) return;
    lastRefreshSignatureRef.current = signature;

    void load(false);
  }, [confirmedReadings, failedReadings, isFocused, isMapping, load, pendingReadings, signalBalance, token, totalReadings]);

  const summary = useMemo(() => {
    if (data?.summary) return data.summary;
    return buildLocalSummary(fallbackSessions, {
      signalBalance,
      totalReadings,
      confirmedReadings,
      pendingReadings,
      failedReadings,
    });
  }, [confirmedReadings, data?.summary, failedReadings, fallbackSessions, pendingReadings, signalBalance, totalReadings]);

  const sessions = useMemo<SessionView[]>(() => {
    if (data?.sessions?.length) return data.sessions;
    return fallbackSessions;
  }, [data?.sessions, fallbackSessions]);

  const latest = data?.latestSession || sessions[0] || null;
  const displayName = username || email?.split('@')[0] || 'Signal mapper';
  const syncMessage = error
    ? 'Server history is temporarily unavailable. Earnings and reading counts below are coming from local device/store data until backend history sync returns.'
    : !data?.sessions?.length && fallbackSessions.length
      ? 'History is still syncing from backend. Some session metrics may appear later.'
      : null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(false);
            }}
            tintColor="#12B59A"
          />
        }
      >
        <View style={styles.headerCard}>
          <Text style={styles.kicker}>History</Text>
          <Text style={styles.title}>Sessions and rewards</Text>
          <Text style={styles.subtitle}>{displayName}</Text>
        </View>

        {syncMessage ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeText}>{syncMessage}</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="small" color="#12B59A" />
            <Text style={styles.loadingText}>Loading history...</Text>
          </View>
        ) : (
          <>
            <View style={styles.summaryRow}>
              <SummaryCard label="Today" value={`${(summary.todayEarnedFlow || 0).toFixed(4)} FLOW`} sub={`${summary.todaySessions || 0} sessions`} accent="#12B59A" />
              <SummaryCard label="All time" value={`${(summary.totalEarnedFlow || 0).toFixed(4)} FLOW`} sub={`${summary.totalReadings || 0} readings`} accent="#14B8A6" />
            </View>

            <View style={styles.summaryRow}>
              <SummaryCard label="Avg down" value={summary.avgDownload != null ? `${summary.avgDownload} Mbps` : 'n/a'} sub="download" accent="#2563EB" />
              <SummaryCard label="Latency" value={summary.avgLatency != null ? `${summary.avgLatency} ms` : 'n/a'} sub="average" accent="#F59E0B" />
            </View>

            {latest ? (
              <View style={styles.latestCard}>
                <View style={styles.latestHeader}>
                  <View>
                    <Text style={styles.latestTitle}>{latest.isActive ? 'Current session' : 'Latest session'}</Text>
                    <Text style={styles.latestSub}>{formatSessionHeading(latest.startedAt)}</Text>
                  </View>
                  <Text style={styles.latestEarned}>+{Number(latest.earnedFlow || 0).toFixed(4)} FLOW</Text>
                </View>

                <View style={styles.latestMetaRow}>
                  <MiniPill label={`${latest.readings} readings`} />
                  <MiniPill label={formatDuration(latest.durationMinutes)} />
                  <MiniPill label={latest.primaryTransport} />
                </View>
              </View>
            ) : null}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Timeline</Text>
              <Text style={styles.sectionSub}>{sessions.length} sessions</Text>
            </View>

            {!sessions.length ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No sessions yet</Text>
                <Text style={styles.emptyText}>Start mapping and this screen will show your latest earnings and session stats.</Text>
              </View>
            ) : (
              <View style={styles.list}>
                {sessions.map((session) => {
                  const isExpanded = !!expanded[session.sessionId];
                  return (
                    <View key={session.sessionId} style={styles.sessionCard}>
                      <TouchableOpacity
                        activeOpacity={0.82}
                        style={styles.sessionTop}
                        onPress={() => setExpanded((prev) => ({ ...prev, [session.sessionId]: !isExpanded }))}
                      >
                        <View style={styles.sessionMain}>
                          <Text style={styles.sessionTime}>{formatSessionHeading(session.startedAt)}</Text>
                          <Text style={styles.sessionMeta}>{session.primaryOperator} | {session.primaryTransport}</Text>
                        </View>

                        <View style={styles.sessionRight}>
                          <Text style={styles.sessionEarned}>+{Number(session.earnedFlow || 0).toFixed(4)}</Text>
                          <Text style={styles.sessionEarnedUnit}>FLOW</Text>
                        </View>
                      </TouchableOpacity>

                      {isExpanded ? (
                        <View style={styles.sessionExpanded}>
                          <View style={styles.metricRow}>
                            <MetricBox label="Signal" value={session.avgSignalDbm != null ? `${session.avgSignalDbm} dBm` : 'n/a'} accent="#12B59A" />
                            <MetricBox label="Down" value={session.avgDownload != null ? `${session.avgDownload} Mbps` : 'n/a'} accent="#2563EB" />
                            <MetricBox label="Latency" value={session.avgLatency != null ? `${session.avgLatency} ms` : 'n/a'} accent="#F59E0B" />
                          </View>

                          <View style={styles.expandedGrid}>
                            <SessionStat label="Duration" value={formatDuration(session.durationMinutes)} />
                            <SessionStat label="Readings" value={String(session.readings)} />
                            <SessionStat label="Confirmed" value={String(session.confirmedReadings)} />
                            <SessionStat label="Pending / failed" value={`${session.pendingReadings}/${session.failedReadings}`} />
                            <SessionStat label="Distance" value={formatDistance(session.approxDistanceMeters)} />
                            <SessionStat label="Coverage" value={formatCoverage(session.approxCoverageKm2)} />
                          </View>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, { color: accent }]}>{value}</Text>
      <Text style={styles.summarySub}>{sub}</Text>
    </View>
  );
}

function MiniPill({ label }: { label: string }) {
  return (
    <View style={styles.miniPill}>
      <Text style={styles.miniPillText}>{label}</Text>
    </View>
  );
}

function MetricBox({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color: accent }]}>{value}</Text>
    </View>
  );
}

function SessionStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.sessionStat}>
      <Text style={styles.sessionStatLabel}>{label}</Text>
      <Text style={styles.sessionStatValue}>{value}</Text>
    </View>
  );
}

function buildLocalSessions(
  readings: any[],
  store: {
    signalBalance: number;
    totalReadings: number;
    confirmedReadings: number;
    pendingReadings: number;
    failedReadings: number;
    isMapping: boolean;
  }
): SessionView[] {
  if (!readings.length) return [];
  const ordered = [...readings]
    .filter((reading) => reading?.createdAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const sessions: any[] = [];

  for (const reading of ordered) {
    const createdAt = new Date(reading.createdAt).getTime();
    const current = sessions[sessions.length - 1];
    if (!current) {
      sessions.push(makeLocalSession(reading));
      continue;
    }

    const currentStart = new Date(current.startedAt).getTime();
    if (currentStart - createdAt < SESSION_GAP_MS) {
      current.items.push(reading);
      current.startedAt = reading.createdAt;
    } else {
      sessions.push(makeLocalSession(reading));
    }
  }

  return reconcileLocalSessions(sessions.map(finalizeLocalSession), store);
}

function makeLocalSession(reading: any) {
  return {
    sessionId: `local-${reading.id}`,
    startedAt: reading.createdAt,
    endedAt: reading.createdAt,
    items: [reading],
  };
}

function finalizeLocalSession(session: { sessionId: string; startedAt: string; endedAt: string; items: any[] }): SessionView {
  const items = [...session.items].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const newest = items[items.length - 1];
  const operatorCounts = countBy(items.map((item) => item.carrier || 'Unknown'));
  const transportCounts = countBy(items.map((item) => item.transportType || item.technology || 'unknown'));
  const avgSignal = average(items.map((item) => item.signalDbm).filter((v) => v != null));
  const avgDown = average(items.map((item) => item.speedDown).filter((v) => v != null));
  const avgUp = average(items.map((item) => item.speedUp).filter((v) => v != null));
  const avgLatency = average(items.map((item) => item.latencyMs).filter((v) => v != null));
  const distance = estimateDistanceMeters(items);
  const coverage = estimateCoverageKm2(items);
  const earned = Number(items.reduce((sum, item) => sum + Number(item.bounty || 0), 0).toFixed(4));
  const now = Date.now();
  const endedAt = newest?.createdAt || session.endedAt;
  const durationMinutes = Math.max(1, Math.round((new Date(endedAt).getTime() - new Date(session.startedAt).getTime()) / 60000));

  return {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    endedAt,
    durationMinutes,
    isActive: now - new Date(endedAt).getTime() < SESSION_GAP_MS,
    readings: items.length,
    confirmedReadings: items.length,
    pendingReadings: 0,
    failedReadings: 0,
    earnedFlow: earned,
    avgSignalDbm: avgSignal,
    avgDownload: avgDown,
    avgUpload: avgUp,
    avgLatency,
    primaryOperator: topKey(operatorCounts),
    primaryTransport: topKey(transportCounts),
    wifiVsMobile: {
      wifi: items.filter((item) => String(item.transportType || item.technology || '').toLowerCase().includes('wifi')).length,
      mobile: items.filter((item) => !String(item.transportType || item.technology || '').toLowerCase().includes('wifi')).length,
    },
    approxDistanceMeters: distance,
    approxCoverageKm2: coverage,
    items: items.map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      status: 'confirmed',
      rewardStatus: item.bounty ? 'paid' : 'pending',
      bountyPaid: Number(item.bounty || 0),
      operator: item.carrier || 'Unknown',
      transport: item.transportType || item.technology || 'unknown',
      technology: item.cellularTechnology || item.technology || null,
      signalDbm: item.signalDbm ?? null,
      speedDown: item.speedDown ?? null,
      speedUp: item.speedUp ?? null,
      latencyMs: item.latencyMs ?? null,
      wifiSsid: item.wifiSsid ?? null,
      trustReceiptTx: null,
      rewardTxHash: null,
      lat: item.lat,
      lng: item.lng,
    })),
  };
}

function buildLocalSummary(
  sessions: SessionView[],
  store: {
    signalBalance: number;
    totalReadings: number;
    confirmedReadings: number;
    pendingReadings: number;
    failedReadings: number;
  }
) {
  const todayKey = new Date().toDateString();
  const todaySessions = sessions.filter((session) => new Date(session.endedAt).toDateString() === todayKey);
  return {
    totalSessions: sessions.length,
    todaySessions: todaySessions.length,
    totalReadings: store.totalReadings || sessions.reduce((sum, session) => sum + session.readings, 0),
    totalEarnedFlow: Number((store.signalBalance || sessions.reduce((sum, session) => sum + Number(session.earnedFlow || 0), 0)).toFixed(4)),
    todayEarnedFlow: Number(todaySessions.reduce((sum, session) => sum + Number(session.earnedFlow || 0), 0).toFixed(4)),
    avgDownload: average(sessions.map((session) => session.avgDownload).filter((v) => v != null)),
    avgUpload: average(sessions.map((session) => session.avgUpload).filter((v) => v != null)),
    avgLatency: average(sessions.map((session) => session.avgLatency).filter((v) => v != null)),
    confirmedReadings: store.confirmedReadings || sessions.reduce((sum, session) => sum + session.confirmedReadings, 0),
    pendingReadings: store.pendingReadings || sessions.reduce((sum, session) => sum + session.pendingReadings, 0),
    failedReadings: store.failedReadings || sessions.reduce((sum, session) => sum + session.failedReadings, 0),
  };
}

function reconcileLocalSessions(
  sessions: SessionView[],
  store: {
    signalBalance: number;
    totalReadings: number;
    confirmedReadings: number;
    pendingReadings: number;
    failedReadings: number;
    isMapping: boolean;
  }
) {
  if (!sessions.length) return sessions;

  const localConfirmed = sessions.reduce((sum, session) => sum + session.confirmedReadings, 0);
  const localPending = sessions.reduce((sum, session) => sum + session.pendingReadings, 0);
  const localFailed = sessions.reduce((sum, session) => sum + session.failedReadings, 0);
  const localEarned = Number(sessions.reduce((sum, session) => sum + Number(session.earnedFlow || 0), 0).toFixed(4));

  const next = sessions.map((session) => ({ ...session }));
  const targetIndex = 0;
  const target = { ...next[targetIndex] };

  const confirmedDelta = Math.max(store.confirmedReadings - localConfirmed, 0);
  const pendingDelta = Math.max(store.pendingReadings - localPending, 0);
  const failedDelta = Math.max(store.failedReadings - localFailed, 0);
  const earnedDelta = Number(Math.max(store.signalBalance - localEarned, 0).toFixed(4));

  target.confirmedReadings += confirmedDelta;
  target.pendingReadings += pendingDelta;
  target.failedReadings += failedDelta;
  target.readings = Math.max(target.readings, target.confirmedReadings + target.pendingReadings + target.failedReadings);
  target.earnedFlow = Number((target.earnedFlow + earnedDelta).toFixed(4));
  target.isActive = store.isMapping || target.isActive;

  next[targetIndex] = target;
  return next;
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function topKey(map: Record<string, number>) {
  const [key] = Object.entries(map).sort((a, b) => b[1] - a[1])[0] || ['Unknown'];
  return key;
}

function average(values: Array<number | null | undefined>) {
  const clean = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!clean.length) return null;
  return Number((clean.reduce((sum, value) => sum + value, 0) / clean.length).toFixed(1));
}

function estimateDistanceMeters(items: any[]) {
  if (items.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < items.length; i += 1) {
    total += haversineMeters(items[i - 1].lat, items[i - 1].lng, items[i].lat, items[i].lng);
  }
  return Math.round(total);
}

function estimateCoverageKm2(items: any[]) {
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

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatSessionHeading(value: string) {
  const date = new Date(value);
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDuration(minutes: number) {
  if (!minutes) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatDistance(meters: number) {
  if (!meters) return '0 m';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatCoverage(km2: number) {
  if (!km2) return '0 km2';
  return `${km2.toFixed(2)} km2`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4FBF8' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  headerCard: { backgroundColor: '#FFFFFF', borderRadius: 28, padding: 20, borderWidth: 1, borderColor: '#D7EEE6' },
  kicker: { fontSize: 11, fontWeight: '900', color: '#12B59A', letterSpacing: 1, textTransform: 'uppercase' },
  title: { marginTop: 8, fontSize: 28, fontWeight: '900', color: '#174B46', lineHeight: 34 },
  subtitle: { marginTop: 8, fontSize: 14, fontWeight: '700', color: '#6E8782' },
  noticeCard: { marginTop: 12, backgroundColor: '#FFF9EC', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: '#F7D58A' },
  noticeText: { fontSize: 12, fontWeight: '800', color: '#8A5B00', lineHeight: 18 },
  loadingCard: { marginTop: 16, backgroundColor: '#FFFFFF', borderRadius: 22, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#D7EEE6' },
  loadingText: { fontSize: 13, fontWeight: '800', color: '#174B46' },
  summaryRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  summaryCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, borderWidth: 1, borderColor: '#D7EEE6' },
  summaryLabel: { fontSize: 10, fontWeight: '900', color: '#7B9891', letterSpacing: 1, textTransform: 'uppercase' },
  summaryValue: { marginTop: 10, fontSize: 22, fontWeight: '900' },
  summarySub: { marginTop: 6, fontSize: 12, fontWeight: '700', color: '#6E8782' },
  latestCard: { marginTop: 16, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 18, borderWidth: 1, borderColor: '#D7EEE6' },
  latestHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  latestTitle: { fontSize: 18, fontWeight: '900', color: '#174B46' },
  latestSub: { marginTop: 4, fontSize: 12, fontWeight: '700', color: '#6E8782' },
  latestEarned: { fontSize: 16, fontWeight: '900', color: '#12B59A' },
  latestMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  miniPill: { backgroundColor: '#F3FBF8', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#D7EEE6' },
  miniPillText: { fontSize: 11, fontWeight: '800', color: '#174B46' },
  sectionHeader: { marginTop: 18, marginBottom: 10 },
  sectionTitle: { fontSize: 20, fontWeight: '900', color: '#174B46' },
  sectionSub: { marginTop: 4, fontSize: 12, fontWeight: '700', color: '#6E8782' },
  emptyCard: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 18, borderWidth: 1, borderColor: '#D7EEE6' },
  emptyTitle: { fontSize: 16, fontWeight: '900', color: '#174B46' },
  emptyText: { marginTop: 8, fontSize: 13, lineHeight: 19, color: '#6E8782', fontWeight: '700' },
  list: { gap: 12 },
  sessionCard: { backgroundColor: '#FFFFFF', borderRadius: 22, borderWidth: 1, borderColor: '#D7EEE6', overflow: 'hidden' },
  sessionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  sessionMain: { flex: 1 },
  sessionTime: { fontSize: 16, fontWeight: '900', color: '#174B46' },
  sessionMeta: { marginTop: 4, fontSize: 12, fontWeight: '700', color: '#6E8782' },
  sessionRight: { alignItems: 'flex-end' },
  sessionEarned: { fontSize: 16, fontWeight: '900', color: '#12B59A' },
  sessionEarnedUnit: { marginTop: 2, fontSize: 10, fontWeight: '900', color: '#6E8782' },
  sessionExpanded: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 4, borderTopWidth: 1, borderTopColor: '#EEF7F2' },
  metricRow: { flexDirection: 'row', gap: 8 },
  metricBox: { flex: 1, backgroundColor: '#FCFEFD', borderWidth: 1, borderColor: '#D7EEE6', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center' },
  metricLabel: { fontSize: 9, fontWeight: '900', color: '#7B9891', letterSpacing: 0.8, textTransform: 'uppercase' },
  metricValue: { marginTop: 6, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  expandedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  sessionStat: { width: '47%', backgroundColor: '#F8FCFA', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#E2F2EC' },
  sessionStatLabel: { fontSize: 10, fontWeight: '900', color: '#7B9891', textTransform: 'uppercase' },
  sessionStatValue: { marginTop: 6, fontSize: 13, fontWeight: '900', color: '#174B46' },
});

