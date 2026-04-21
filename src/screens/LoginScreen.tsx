import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import useMapperStore from '../store/useMapperStore';
import { login, setAuthToken, verifyOtp } from '../services/api';

type AuthResponse = {
  token?: string;
  user?: {
    email?: string | null;
    username?: string | null;
    evm_address?: string | null;
    evmAddress?: string | null;
  };
};

export default function LoginScreen() {
  const { setToken, setUser } = useMapperStore();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [loading, setLoading] = useState(false);

  const completeAuth = (res: AuthResponse) => {
    if (!res.token) throw new Error('Auth token missing');
    setAuthToken(res.token);
    setToken(res.token);
    if (res.user) setUser(res.user);
  };

  const handleSendOtp = async () => {
    if (!email.trim()) {
      Alert.alert('Email required', 'Enter your email to receive a login code.');
      return;
    }

    setLoading(true);
    try {
      await login(email.trim());
      setStep('otp');
    } catch (err: any) {
      Alert.alert('OTP failed', err.response?.data?.error || err.message || 'Failed to send OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!otp.trim()) {
      Alert.alert('Code required', 'Enter the code from your email.');
      return;
    }

    setLoading(true);
    try {
      const res = await verifyOtp(email.trim(), otp.trim());
      completeAuth(res);
    } catch (err: any) {
      Alert.alert('Invalid code', err.response?.data?.error || err.message || 'The OTP code was not accepted.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.orb} />
      <View style={styles.dotField}>
        <View style={[styles.mapDot, styles.dotA]} />
        <View style={[styles.mapDot, styles.dotB]} />
        <View style={[styles.mapDot, styles.dotC]} />
        <View style={[styles.mapDot, styles.dotD]} />
      </View>

      <View style={styles.content}>
        <View style={styles.brandRow}>
          <View style={styles.brandIcon}>
            <Text style={styles.brandIconText}>S</Text>
          </View>
          <Text style={styles.logo}>SignalMap</Text>
        </View>

        <Text style={styles.title}>Ready to Map?</Text>
        <Text style={styles.subtitle}>
          Join the decentralized coverage network. Collect real signal samples and earn testnet FLOW.
        </Text>

        <View style={styles.card}>
          {step === 'email' ? (
            <>
              <Text style={styles.label}>Email login</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor="#94A3B8"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity style={styles.button} onPress={handleSendOtp} activeOpacity={0.85} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send code</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.label}>Code sent to {email}</Text>
              <TextInput
                style={styles.input}
                placeholder="123456"
                placeholderTextColor="#94A3B8"
                value={otp}
                onChangeText={setOtp}
                keyboardType="number-pad"
              />
              <TouchableOpacity style={styles.button} onPress={handleVerify} activeOpacity={0.85} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify and login</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep('email')} style={styles.backLink}>
                <Text style={styles.backText}>Change email</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  orb: {
    position: 'absolute',
    top: -90,
    alignSelf: 'center',
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  dotField: { ...StyleSheet.absoluteFillObject },
  mapDot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981' },
  dotA: { top: 114, left: 54 },
  dotB: { top: 180, right: 42, backgroundColor: '#F59E0B' },
  dotC: { top: 250, left: 90, width: 8, height: 8, borderRadius: 4 },
  dotD: { bottom: 230, right: 86, backgroundColor: '#EF4444' },
  content: { flex: 1, justifyContent: 'center', padding: 24 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  brandIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },
  brandIconText: { fontSize: 17, fontWeight: '900', color: '#4F46E5' },
  logo: { fontSize: 22, fontWeight: '900', color: '#0F172A' },
  title: { fontSize: 32, fontWeight: '900', color: '#0F172A', textAlign: 'center', letterSpacing: -0.8 },
  subtitle: { fontSize: 15, fontWeight: '700', color: '#64748B', textAlign: 'center', marginTop: 12, lineHeight: 23, marginBottom: 8 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    padding: 22,
    marginTop: 28,
    shadowColor: '#064E3B',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 6,
  },
  label: { fontSize: 11, fontWeight: '900', color: '#64748B', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 9 },
  input: {
    borderWidth: 1,
    borderColor: '#DDE7E3',
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 16,
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  button: {
    backgroundColor: '#10B981',
    borderRadius: 17,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
    shadowColor: '#047857',
    shadowOpacity: 0.75,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 6 },
  },
  buttonText: { fontSize: 16, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.4 },
  backLink: { marginTop: 14, alignItems: 'center' },
  backText: { fontSize: 13, fontWeight: '800', color: '#64748B' },
});
