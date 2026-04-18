import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, SafeAreaView, ScrollView, Alert } from 'react-native';
import useMapperStore from '../store/useMapperStore';
import { getMapperStats, faucet } from '../services/api';

export default function ProfileScreen() {
  const { token, signalBalance, flowBalance, totalReadings, evmAddress, setBalances, setEvmAddress } = useMapperStore();
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const stats = await getMapperStats();
      setBalances(stats.signalBalance, parseFloat(stats.flowBalance));
      if (stats.evmAddress) setEvmAddress(stats.evmAddress);
    } catch {}
    setLoading(false);
  };

  const handleFaucet = async () => {
    if (!token) return;
    try {
      const res = await faucet();
      Alert.alert('Faucet', res.message || `+${res.amount} FLOW received!`);
      refresh();
    } catch (err: any) {
      Alert.alert('Faucet Error', err.response?.data?.error || 'Failed');
    }
  };

  useEffect(() => { refresh(); }, [token]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>📡 Mapper Profile</Text>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Earned FLOW</Text>
          <Text style={styles.cardValue}>{signalBalance.toFixed(4)}</Text>
          <Text style={styles.cardSub}>from {totalReadings} signal readings</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>On-Chain Balance</Text>
          <Text style={styles.cardValue}>{parseFloat(String(flowBalance)).toFixed(4)} FLOW</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Wallet</Text>
          <Text style={styles.cardAddress}>{evmAddress || 'Loading...'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Total Readings</Text>
          <Text style={styles.cardValue}>{totalReadings}</Text>
          <Text style={styles.cardSub}>
            {totalReadings > 100 ? '🏅 Gold Mapper' : totalReadings > 50 ? '🥈 Silver Mapper' : totalReadings > 10 ? '🥉 Bronze Mapper' : '🌱 New Mapper'}
          </Text>
        </View>

        <TouchableOpacity style={styles.button} onPress={handleFaucet} activeOpacity={0.8}>
          <Text style={styles.buttonText}>🚰 Get Test FLOW</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.button, styles.refreshButton]} onPress={refresh} activeOpacity={0.8}>
          <Text style={styles.refreshText}>{loading ? 'Loading...' : '↻ Refresh'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 20, gap: 12 },
  title: { fontSize: 24, fontWeight: '900', color: '#1E293B', marginBottom: 8 },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  cardLabel: { fontSize: 11, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase' },
  cardValue: { fontSize: 28, fontWeight: '900', color: '#22C55E', marginTop: 4 },
  cardSub: { fontSize: 12, fontWeight: '600', color: '#64748B', marginTop: 2 },
  cardAddress: { fontSize: 11, fontWeight: '600', color: '#475569', marginTop: 4, fontFamily: 'monospace' },
  button: {
    backgroundColor: '#22C55E', borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    marginTop: 4,
  },
  buttonText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  refreshButton: { backgroundColor: '#F1F5F9' },
  refreshText: { fontSize: 14, fontWeight: '700', color: '#64748B' },
});
