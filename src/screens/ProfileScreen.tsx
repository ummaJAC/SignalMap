import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Alert,
  Linking,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import useMapperStore from '../store/useMapperStore';
import { exportPrivateKey, faucet, getMapperStats, setAuthToken } from '../services/api';

const FLOWSCAN_BASE = 'https://evm-testnet.flowscan.io';

export default function ProfileScreen() {
  const {
    token,
    signalBalance,
    flowBalance,
    totalReadings,
    confirmedReadings,
    pendingReadings,
    failedReadings,
    pendingRewards,
    failedRewards,
    evmAddress,
    lastReward,
    email,
    username,
    setStats,
    reset,
  } = useMapperStore();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const refresh = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const stats = await getMapperStats();
      setStats(stats);
    } catch (err: any) {
      Alert.alert('Refresh failed', err.response?.data?.error || 'Could not load mapper stats.');
    } finally {
      setLoading(false);
    }
  };

  const copyWallet = async () => {
    if (!evmAddress) return;
    await Clipboard.setStringAsync(evmAddress);
    Alert.alert('Copied', 'Wallet address copied.');
  };

  const openWallet = () => {
    if (!evmAddress) return;
    Linking.openURL(`${FLOWSCAN_BASE}/address/${evmAddress}`);
  };

  const openLastReward = () => {
    if (!lastReward?.reward_tx_hash) return;
    Linking.openURL(`${FLOWSCAN_BASE}/tx/${lastReward.reward_tx_hash}`);
  };

  const handleExportKey = () => {
    Alert.alert(
      'Export private key',
      'Anyone with this key controls the wallet. Export it only if you want to use the same wallet in another app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy key',
          style: 'destructive',
          onPress: async () => {
            setExporting(true);
            try {
              const res = await exportPrivateKey();
              if (!res.privateKey) throw new Error('Private key missing');
              await Clipboard.setStringAsync(res.privateKey);
              Alert.alert('Private key copied', 'Import it into Rabby and add Flow EVM Testnet to verify rewards.');
            } catch (err: any) {
              Alert.alert('Export failed', err.response?.data?.error || err.message || 'Could not export key.');
            } finally {
              setExporting(false);
            }
          },
        },
      ]
    );
  };

  const handleFaucet = async () => {
    if (!token) return;
    try {
      const res = await faucet();
      Alert.alert('Faucet', res.message || `+${res.amount} FLOW received.`);
      await refresh();
    } catch (err: any) {
      Alert.alert('Faucet error', err.response?.data?.error || 'Failed to request test FLOW.');
    }
  };

  const handleLogout = () => {
    Alert.alert('Log out', 'This removes the local session only. Your wallet/profile stays on backend.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => {
          setAuthToken(null);
          reset();
        },
      },
    ]);
  };

  useEffect(() => {
    void refresh();
  }, [token]);

  const rank = getRank(totalReadings);
  const displayName = username || email?.split('@')[0] || 'Signal mapper';
  const paidRewards = Math.max(0, confirmedReadings - pendingRewards - failedRewards);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View style={styles.brandBadge}>
              <Text style={styles.brandMark}>S</Text>
            </View>
            <View style={styles.levelPill}>
              <Text style={styles.levelText}>LVL {rank.level}</Text>
              <Text style={styles.levelSub}>{rank.label}</Text>
            </View>
          </View>

          <Text style={styles.heroKicker}>Mapper profile</Text>
          <Text style={styles.heroName}>{displayName}</Text>
          <Text style={styles.heroEmail}>{email || 'SignalMap account'}</Text>

          <View style={styles.heroStats}>
            <StatChip label="Readings" value={String(totalReadings)} />
            <StatChip label="Confirmed" value={String(confirmedReadings)} />
            <StatChip label="Rewards" value={String(paidRewards)} />
          </View>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.sectionKicker}>Earned ledger FLOW</Text>
          <Text style={styles.balanceValue}>{signalBalance.toFixed(4)}</Text>
          <Text style={styles.balanceSub}>from {confirmedReadings} confirmed signal readings</Text>
        </View>

        <View style={styles.gridRow}>
          <View style={styles.infoCard}>
            <Text style={styles.sectionKicker}>On-chain balance</Text>
            <Text style={styles.infoValue}>{parseFloat(String(flowBalance || 0)).toFixed(4)}</Text>
            <Text style={styles.infoSub}>FLOW testnet</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.sectionKicker}>Reading state</Text>
            <Text style={styles.infoValue}>{confirmedReadings}/{totalReadings}</Text>
            <Text style={styles.infoSub}>pending {pendingReadings} / failed {failedReadings}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Wallet proof</Text>
            <Text style={styles.badge}>FLOW EVM</Text>
          </View>
          <Text style={styles.monoText}>{evmAddress || 'Loading wallet address...'}</Text>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.softAction} onPress={copyWallet} disabled={!evmAddress}>
              <Text style={styles.softActionText}>Copy address</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.softAction} onPress={openWallet} disabled={!evmAddress}>
              <Text style={styles.softActionText}>Open FlowScan</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Last reward</Text>
            <Text style={[styles.statusBadge, lastReward?.reward_status === 'paid' ? styles.statusPaid : null]}>
              {String(lastReward?.reward_status || 'none').toUpperCase()}
            </Text>
          </View>
          <Text style={styles.monoText}>{lastReward?.reward_tx_hash || lastReward?.reward_error || 'Start mapping to receive real testnet payouts.'}</Text>
          <Text style={styles.infoSub}>pending rewards: {pendingRewards} / failed rewards: {failedRewards}</Text>
          {lastReward?.reward_tx_hash ? (
            <TouchableOpacity style={styles.softActionWide} onPress={openLastReward}>
              <Text style={styles.softActionText}>Open reward tx</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={handleFaucet} activeOpacity={0.86}>
          <Text style={styles.primaryButtonText}>Get Test FLOW</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.primaryButton} onPress={handleExportKey} activeOpacity={0.86} disabled={exporting}>
          <Text style={styles.primaryButtonText}>{exporting ? 'Exporting...' : 'Export private key'}</Text>
          <Text style={styles.primarySub}>Use this wallet in Rabby or any compatible Flow EVM wallet.</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={refresh} activeOpacity={0.86}>
          <Text style={styles.secondaryButtonText}>{loading ? 'Loading...' : 'Refresh stats'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.86}>
          <Text style={styles.logoutButtonText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function getRank(readings: number) {
  if (readings > 100) return { label: 'Gold Mapper', level: 12 };
  if (readings > 50) return { label: 'Silver Mapper', level: 8 };
  if (readings > 10) return { label: 'Bronze Mapper', level: 4 };
  return { label: 'New Mapper', level: 1 };
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statChip}>
      <Text style={styles.statChipLabel}>{label}</Text>
      <Text style={styles.statChipValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3FBF8' },
  content: { padding: 18, paddingBottom: 34, gap: 14 },
  heroCard: {
    backgroundColor: '#EFFAF4',
    borderRadius: 34,
    padding: 22,
    borderWidth: 1,
    borderColor: '#D8EEE6',
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brandBadge: { width: 58, height: 58, borderRadius: 18, backgroundColor: '#12B59A', alignItems: 'center', justifyContent: 'center' },
  brandMark: { color: '#FFFFFF', fontSize: 28, fontWeight: '900' },
  levelPill: { backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  levelText: { color: '#12B59A', fontSize: 16, fontWeight: '900' },
  levelSub: { color: '#6E8782', fontSize: 10, fontWeight: '900', marginTop: 2 },
  heroKicker: { fontSize: 12, fontWeight: '900', color: '#6E8782', textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 16 },
  heroName: { fontSize: 34, fontWeight: '900', color: '#174B46', marginTop: 10, letterSpacing: -0.9 },
  heroEmail: { fontSize: 15, fontWeight: '800', color: '#6E8782', marginTop: 6 },
  heroStats: { flexDirection: 'row', gap: 10, marginTop: 18 },
  statChip: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#DCEBE4' },
  statChipLabel: { fontSize: 10, fontWeight: '900', color: '#8BA6A0', textTransform: 'uppercase', letterSpacing: 0.8 },
  statChipValue: { fontSize: 26, fontWeight: '900', color: '#174B46', marginTop: 8 },
  balanceCard: { backgroundColor: '#FFFFFF', borderRadius: 28, padding: 20, borderWidth: 1, borderColor: '#DCEBE4' },
  sectionKicker: { fontSize: 11, fontWeight: '900', color: '#8BA6A0', textTransform: 'uppercase', letterSpacing: 1 },
  balanceValue: { fontSize: 52, fontWeight: '900', color: '#12B59A', marginTop: 8, letterSpacing: -1.4 },
  balanceSub: { fontSize: 13, fontWeight: '800', color: '#6E8782', marginTop: 6 },
  gridRow: { flexDirection: 'row', gap: 12 },
  infoCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 18, borderWidth: 1, borderColor: '#DCEBE4' },
  infoValue: { fontSize: 32, fontWeight: '900', color: '#174B46', marginTop: 10, letterSpacing: -0.8 },
  infoSub: { fontSize: 12, fontWeight: '800', color: '#6E8782', marginTop: 8, lineHeight: 18 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 28, padding: 18, borderWidth: 1, borderColor: '#DCEBE4' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 18, fontWeight: '900', color: '#174B46' },
  badge: { fontSize: 10, fontWeight: '900', color: '#3B82F6', backgroundColor: '#EFF6FF', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  statusBadge: { fontSize: 10, fontWeight: '900', color: '#92400E', backgroundColor: '#FEF3C7', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  statusPaid: { backgroundColor: '#D1FAE5', color: '#047857' },
  monoText: { fontSize: 11, fontWeight: '800', color: '#475569', marginTop: 12, lineHeight: 18, fontFamily: 'monospace' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  softAction: { flex: 1, backgroundColor: '#ECFBF5', borderRadius: 18, paddingVertical: 14, alignItems: 'center' },
  softActionWide: { backgroundColor: '#ECFBF5', borderRadius: 18, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  softActionText: { fontSize: 14, fontWeight: '900', color: '#129C7F' },
  primaryButton: { backgroundColor: '#12B59A', borderRadius: 22, paddingVertical: 18, alignItems: 'center' },
  primaryButtonText: { fontSize: 17, fontWeight: '900', color: '#FFFFFF' },
  primarySub: { fontSize: 11, fontWeight: '800', color: '#D8FFF5', marginTop: 4 },
  secondaryButton: { backgroundColor: '#E6EDFF', borderRadius: 22, paddingVertical: 18, alignItems: 'center' },
  secondaryButtonText: { fontSize: 15, fontWeight: '900', color: '#5A63D8' },
  logoutButton: { backgroundColor: '#FDE7EA', borderRadius: 22, paddingVertical: 18, alignItems: 'center' },
  logoutButtonText: { fontSize: 15, fontWeight: '900', color: '#D63B53' },
});
