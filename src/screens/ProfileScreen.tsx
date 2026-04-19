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
    evmAddress,
    lastReward,
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
      'This is demo custody for hackathon/testnet only. Anyone with this key controls the wallet.',
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
    refresh();
  }, [token]);

  const mapperRank = totalReadings > 100 ? 'Gold Mapper' : totalReadings > 50 ? 'Silver Mapper' : totalReadings > 10 ? 'Bronze Mapper' : 'New Mapper';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Mapper Profile</Text>
        <Text style={styles.subtitle}>Your DePIN wallet and reward ledger.</Text>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Earned ledger FLOW</Text>
          <Text style={styles.cardValue}>{signalBalance.toFixed(4)}</Text>
          <Text style={styles.cardSub}>from {totalReadings} confirmed readings</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>On-chain wallet balance</Text>
          <Text style={styles.cardValue}>{parseFloat(String(flowBalance || 0)).toFixed(4)} FLOW</Text>
          <Text style={styles.cardSub}>Flow EVM Testnet</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Wallet address</Text>
          <Text style={styles.cardAddress}>{evmAddress || 'Loading...'}</Text>
          <View style={styles.rowButtons}>
            <TouchableOpacity style={styles.secondaryButton} onPress={copyWallet} disabled={!evmAddress}>
              <Text style={styles.secondaryText}>Copy address</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={openWallet} disabled={!evmAddress}>
              <Text style={styles.secondaryText}>Open FlowScan</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Last reward</Text>
          <Text style={styles.rewardStatus}>{lastReward?.reward_status || 'No reward yet'}</Text>
          <Text style={styles.cardSub}>{lastReward?.reward_tx_hash || lastReward?.reward_error || 'Start mapping to receive real testnet payouts.'}</Text>
          {lastReward?.reward_tx_hash ? (
            <TouchableOpacity style={styles.secondaryButtonWide} onPress={openLastReward}>
              <Text style={styles.secondaryText}>Open reward tx</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Total readings</Text>
          <Text style={styles.cardValue}>{totalReadings}</Text>
          <Text style={styles.cardSub}>{mapperRank}</Text>
        </View>

        <TouchableOpacity style={styles.button} onPress={handleFaucet} activeOpacity={0.8}>
          <Text style={styles.buttonText}>Get Test FLOW</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={handleExportKey} activeOpacity={0.8} disabled={exporting}>
          <Text style={styles.buttonText}>{exporting ? 'Exporting...' : 'Export private key'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.button, styles.refreshButton]} onPress={refresh} activeOpacity={0.8}>
          <Text style={styles.refreshText}>{loading ? 'Loading...' : 'Refresh'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.button, styles.logoutButton]} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 20, gap: 12 },
  title: { fontSize: 28, fontWeight: '900', color: '#0F172A' },
  subtitle: { fontSize: 13, fontWeight: '700', color: '#64748B', marginBottom: 8 },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardLabel: { fontSize: 11, fontWeight: '800', color: '#94A3B8', textTransform: 'uppercase' },
  cardValue: { fontSize: 28, fontWeight: '900', color: '#16A34A', marginTop: 4 },
  cardSub: { fontSize: 12, fontWeight: '700', color: '#64748B', marginTop: 4, lineHeight: 17 },
  cardAddress: { fontSize: 11, fontWeight: '700', color: '#475569', marginTop: 8, fontFamily: 'monospace' },
  rewardStatus: { fontSize: 18, fontWeight: '900', color: '#0F172A', marginTop: 6, textTransform: 'uppercase' },
  rowButtons: { flexDirection: 'row', gap: 8, marginTop: 12 },
  secondaryButton: { flex: 1, backgroundColor: '#ECFDF5', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  secondaryButtonWide: { backgroundColor: '#ECFDF5', borderRadius: 12, paddingVertical: 10, alignItems: 'center', marginTop: 12 },
  secondaryText: { fontSize: 12, fontWeight: '900', color: '#15803D' },
  button: { backgroundColor: '#16A34A', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  buttonText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
  refreshButton: { backgroundColor: '#F1F5F9' },
  refreshText: { fontSize: 14, fontWeight: '900', color: '#64748B' },
  logoutButton: { backgroundColor: '#FEE2E2' },
  logoutText: { fontSize: 14, fontWeight: '900', color: '#B91C1C' },
});
