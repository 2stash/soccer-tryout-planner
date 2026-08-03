import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { colors } from '@/constants/theme';

function readHashError(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const description = params.get('error_description') ?? params.get('error');
  if (!description) return null;
  return description.replace(/\+/g, ' ');
}

export default function ResetPasswordScreen() {
  const {
    session,
    loading,
    configured,
    passwordRecovery,
    updatePassword,
    clearPasswordRecovery,
  } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hashError = readHashError();
    if (hashError) setError(hashError);
  }, []);

  if (!loading && !session && !error) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (!loading && session && !passwordRecovery) {
    return <Redirect href="/dashboard" />;
  }

  async function handleSubmit() {
    setError(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      router.replace('/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update password');
    } finally {
      setBusy(false);
    }
  }

  if (!session && error) {
    return (
      <KeyboardAvoidingView style={styles.screen}>
        <View style={styles.card}>
          <Text style={styles.brand}>Reset link failed</Text>
          <Text style={styles.subtitle}>
            The email link is invalid or expired. Request a new one from Sign in
            → Forgot password, then open the newest email once in this browser.
          </Text>
          <Text style={styles.error}>{error}</Text>
          <Pressable
            style={styles.primaryBtn}
            onPress={() => router.replace('/(auth)/sign-in')}
          >
            <Text style={styles.primaryText}>Back to sign in</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.brand}>Set a new password</Text>
        <Text style={styles.subtitle}>
          Choose a new password for {session?.user?.email ?? 'your account'}.
        </Text>

        {!configured ? (
          <View style={styles.warn}>
            <Text style={styles.warnText}>Supabase is not configured.</Text>
          </View>
        ) : null}

        <View style={styles.field}>
          <Text style={styles.label}>New password</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.muted}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Confirm password</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            value={confirm}
            onChangeText={setConfirm}
            placeholder="••••••••"
            placeholderTextColor={colors.muted}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.primaryBtn, (!configured || busy) && styles.disabled]}
          disabled={!configured || busy}
          onPress={() => void handleSubmit()}
        >
          <Text style={styles.primaryText}>
            {busy ? 'Saving…' : 'Update password'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            clearPasswordRecovery();
            router.replace('/dashboard');
          }}
        >
          <Text style={styles.switch}>Skip for now</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    gap: 14,
  },
  brand: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    color: colors.muted,
    marginBottom: 4,
  },
  warn: {
    backgroundColor: colors.warningBg,
    borderRadius: 8,
    padding: 12,
  },
  warnText: {
    color: colors.warningText,
    lineHeight: 20,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  error: {
    color: colors.danger,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryText: {
    color: colors.primaryText,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.55,
  },
  switch: {
    textAlign: 'center',
    color: colors.primary,
    fontWeight: '600',
    marginTop: 4,
  },
});
