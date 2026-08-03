import { useState } from 'react';
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

type Mode = 'sign-in' | 'sign-up' | 'forgot';

export default function SignInScreen() {
  const {
    signIn,
    signUp,
    resetPassword,
    session,
    passwordRecovery,
    configured,
    loading,
  } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>('sign-in');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  if (!loading && session && passwordRecovery) {
    return <Redirect href="/(auth)/reset-password" />;
  }

  if (!loading && session) {
    return <Redirect href="/dashboard" />;
  }

  async function handleSubmit() {
    setError(null);
    setInfo(null);

    if (!email.trim()) {
      setError('Email is required.');
      return;
    }

    if (mode === 'forgot') {
      setBusy(true);
      try {
        await resetPassword(email.trim());
        setInfo(
          'Reset email sent. Open the newest link in this same browser (links expire and only work once). If it still goes to the wrong host, update Supabase Site URL (see note below).'
        );
        setMode('sign-in');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not send reset email');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!password) {
      setError('Email and password are required.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'sign-in') {
        await signIn(email.trim(), password);
        router.replace('/dashboard');
      } else {
        await signUp(email.trim(), password);
        setInfo(
          'Account created. If email confirmation is enabled in Supabase, check your inbox; otherwise you can sign in now.'
        );
        setMode('sign-in');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  }

  const subtitle =
    mode === 'sign-in'
      ? 'Sign in to manage tryout rosters'
      : mode === 'sign-up'
        ? 'Create a coach account'
        : 'We’ll email you a link to set a new password';

  const primaryLabel =
    mode === 'sign-in'
      ? 'Sign in'
      : mode === 'sign-up'
        ? 'Create account'
        : 'Send reset link';

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.brand}>Soccer Tryout Planner</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        {!configured ? (
          <View style={styles.warn}>
            <Text style={styles.warnText}>
              Supabase is not configured. Copy `.env.example` to `.env`, add your project URL and
              anon key, then restart Expo. Also run `supabase/migrations/001_initial.sql` in the
              Supabase SQL editor.
            </Text>
          </View>
        ) : null}

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            placeholder="coach@school.edu"
            placeholderTextColor={colors.muted}
          />
        </View>

        {mode !== 'forgot' ? (
          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.muted}
            />
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {info ? <Text style={styles.info}>{info}</Text> : null}

        <Pressable
          style={[styles.primaryBtn, (!configured || busy) && styles.disabled]}
          disabled={!configured || busy}
          onPress={() => void handleSubmit()}
        >
          <Text style={styles.primaryText}>
            {busy ? 'Please wait…' : primaryLabel}
          </Text>
        </Pressable>

        {mode === 'sign-in' ? (
          <Pressable
            onPress={() => {
              setMode('forgot');
              setError(null);
              setInfo(null);
            }}
          >
            <Text style={styles.switch}>Forgot password?</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => {
            if (mode === 'forgot') {
              setMode('sign-in');
            } else {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
            }
            setError(null);
            setInfo(null);
          }}
        >
          <Text style={styles.switch}>
            {mode === 'forgot'
              ? 'Back to sign in'
              : mode === 'sign-in'
                ? 'Need an account? Sign up'
                : 'Already have an account? Sign in'}
          </Text>
        </Pressable>

        {mode === 'forgot' ? (
          <Text style={styles.hint}>
            Supabase → Authentication → URL Configuration: set Site URL to your
            app (e.g. http://localhost:8081) and add Redirect URL
            http://localhost:8081/reset-password
          </Text>
        ) : null}
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
  info: {
    color: colors.primary,
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
  hint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
});

