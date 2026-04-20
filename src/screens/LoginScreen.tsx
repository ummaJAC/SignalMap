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
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import useMapperStore from '../store/useMapperStore';
import { googleLogin, login, setAuthToken, verifyOtp } from '../services/api';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '';

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
  const [googleLoading, setGoogleLoading] = useState(false);

  const [request, response, promptAsync] = Google.useAuthRequest({
    androidClientId: GOOGLE_CLIENT_ID,
    webClientId: GOOGLE_CLIENT_ID,
  });

  const completeAuth = (res: AuthResponse) => {
    if (!res.token) throw new Error('Auth token missing');
    setAuthToken(res.token);
    setToken(res.token);
    if (res.user) setUser(res.user);
  };

  useEffect(() => {
    if (response?.type !== 'success') return;

    const accessToken = response.authentication?.accessToken;
    if (!accessToken) {
      Alert.alert('Google login failed', 'Google did not return an access token.');
      return;
    }

    setGoogleLoading(true);
    googleLogin(accessToken)
      .then(completeAuth)
      .catch((err: any) => {
        Alert.alert('Google login failed', err.response?.data?.error || err.message || 'Could not sign in with Google.');
      })
      .finally(() => setGoogleLoading(false));
  }, [response]);

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

  const handleGoogle = async () => {
    if (!GOOGLE_CLIENT_ID) {
      Alert.alert('Google is not configured', 'Set EXPO_PUBLIC_GOOGLE_CLIENT_ID before the demo build.');
      return;
    }
    await promptAsync();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.logo}>SignalMap</Text>
        <Text style={styles.subtitle}>Earn testnet FLOW by mapping real network coverage.</Text>

        <View style={styles.card}>
          {step === 'email' ? (
            <>
              <Text style={styles.label}>Email login</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity style={styles.button} onPress={handleSendOtp} activeOpacity={0.8} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send code</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.label}>Code sent to {email}</Text>
              <TextInput
                style={styles.input}
                placeholder="123456"
                value={otp}
                onChangeText={setOtp}
                keyboardType="number-pad"
              />
              <TouchableOpacity style={styles.button} onPress={handleVerify} activeOpacity={0.8} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify and login</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep('email')} style={styles.backLink}>
                <Text style={styles.backText}>Change email</Text>
              </TouchableOpacity>
            </>
          )}

          <View style={styles.divider} />

          <TouchableOpacity
            style={[styles.googleButton, (!request || googleLoading) && styles.disabledButton]}
            onPress={handleGoogle}
            activeOpacity={0.8}
            disabled={!request || googleLoading}
          >
            {googleLoading ? <ActivityIndicator color="#1E293B" /> : <Text style={styles.googleText}>Continue with Google</Text>}
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>
          A Flow EVM testnet wallet is created automatically. You can export the private key from Profile for the hackathon demo.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ECFDF5' },
  content: { flex: 1, justifyContent: 'center', padding: 24 },
  logo: { fontSize: 36, fontWeight: '900', color: '#0F172A', textAlign: 'center' },
  subtitle: { fontSize: 14, fontWeight: '700', color: '#475569', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, marginTop: 32,
    shadowColor: '#064E3B', shadowOpacity: 0.12, shadowRadius: 16, elevation: 5,
  },
  label: { fontSize: 12, fontWeight: '800', color: '#64748B', textTransform: 'uppercase', marginBottom: 8 },
  input: {
    borderWidth: 1, borderColor: '#DDE7E3', borderRadius: 14, paddingVertical: 13,
    paddingHorizontal: 16, fontSize: 16, fontWeight: '700', color: '#0F172A', backgroundColor: '#F8FAFC',
  },
  button: { backgroundColor: '#16A34A', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  buttonText: { fontSize: 16, fontWeight: '900', color: '#FFFFFF' },
  backLink: { marginTop: 12, alignItems: 'center' },
  backText: { fontSize: 13, fontWeight: '700', color: '#64748B' },
  divider: { height: 1, backgroundColor: '#E2E8F0', marginVertical: 20 },
  googleButton: {
    backgroundColor: '#F8FAFC', borderRadius: 14, paddingVertical: 15, alignItems: 'center',
    borderWidth: 1, borderColor: '#CBD5E1',
  },
  googleText: { fontSize: 15, fontWeight: '900', color: '#1E293B' },
  disabledButton: { opacity: 0.6 },
  footer: { fontSize: 12, fontWeight: '700', color: '#64748B', textAlign: 'center', marginTop: 24, lineHeight: 18 },
});
