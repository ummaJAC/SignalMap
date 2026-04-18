import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, SafeAreaView, Alert, ActivityIndicator } from 'react-native';
import useMapperStore from '../store/useMapperStore';
import { login, verifyOtp, setAuthToken } from '../services/api';

export default function LoginScreen() {
  const { setToken, setEvmAddress } = useMapperStore();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [loading, setLoading] = useState(false);

  const handleSendOtp = async () => {
    if (!email.trim()) return Alert.alert('Error', 'Enter email');
    setLoading(true);
    try {
      await login(email.trim());
      setStep('otp');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to send OTP');
    }
    setLoading(false);
  };

  const handleVerify = async () => {
    if (!otp.trim()) return Alert.alert('Error', 'Enter OTP');
    setLoading(true);
    try {
      const res = await verifyOtp(email.trim(), otp.trim());
      if (res.token) {
        setToken(res.token);
        setAuthToken(res.token);
        if (res.user?.evm_address) setEvmAddress(res.user.evm_address);
      }
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Invalid OTP');
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.logo}>📡 SignalMap</Text>
        <Text style={styles.subtitle}>DePIN Coverage Intelligence</Text>

        <View style={styles.card}>
          {step === 'email' ? (
            <>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.button} onPress={handleSendOtp} activeOpacity={0.8}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send OTP</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.label}>Enter OTP sent to {email}</Text>
              <TextInput
                style={styles.input}
                placeholder="123456"
                value={otp}
                onChangeText={setOtp}
                keyboardType="number-pad"
              />
              <TouchableOpacity style={styles.button} onPress={handleVerify} activeOpacity={0.8}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify & Login</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep('email')} style={styles.backLink}>
                <Text style={styles.backText}>← Change email</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <Text style={styles.footer}>
          Earn FLOW by mapping cellular coverage.{'\n'}Your phone = a DePIN sensor.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0FDF4' },
  content: { flex: 1, justifyContent: 'center', padding: 24 },
  logo: { fontSize: 32, fontWeight: '900', color: '#1E293B', textAlign: 'center' },
  subtitle: { fontSize: 14, fontWeight: '700', color: '#64748B', textAlign: 'center', marginTop: 4 },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24, marginTop: 32,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  label: { fontSize: 12, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', marginBottom: 8 },
  input: {
    borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingVertical: 12,
    paddingHorizontal: 16, fontSize: 16, fontWeight: '600', color: '#1E293B',
  },
  button: {
    backgroundColor: '#22C55E', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16,
  },
  buttonText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  backLink: { marginTop: 12, alignItems: 'center' },
  backText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  footer: { fontSize: 12, fontWeight: '600', color: '#94A3B8', textAlign: 'center', marginTop: 24, lineHeight: 18 },
});
