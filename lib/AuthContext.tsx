import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/** Where Supabase should send the user after they click the email link. */
export function getPasswordResetRedirectUrl(): string {
  const configured = process.env.EXPO_PUBLIC_APP_URL?.replace(/\/$/, '');
  if (configured) return `${configured}/reset-password`;

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}/reset-password`;
  }

  return Linking.createURL('/reset-password');
}

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  configured: boolean;
  /** True after opening a password-recovery email link. */
  passwordRecovery: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  clearPasswordRecovery: () => void;
};

function getParamsFromUrl(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const queryIndex = url.indexOf('?');
  const hashIndex = url.indexOf('#');
  const query =
    queryIndex >= 0
      ? url.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined)
      : '';
  const hash = hashIndex >= 0 ? url.slice(hashIndex + 1) : '';
  for (const part of [query, hash]) {
    for (const pair of part.split('&')) {
      if (!pair) continue;
      const [rawKey, rawValue = ''] = pair.split('=');
      if (!rawKey) continue;
      params[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue);
    }
  }
  return params;
}

async function createSessionFromUrl(url: string): Promise<boolean> {
  const params = getParamsFromUrl(url);
  if (params.error || params.error_description) {
    throw new Error(
      params.error_description?.replace(/\+/g, ' ') ||
        params.error ||
        'Auth link failed'
    );
  }

  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) throw error;
    return true;
  }

  if (params.access_token && params.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });
    if (error) throw error;
    return true;
  }

  return false;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setLoading(false);
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event, next) => {
        setSession(next);
        setLoading(false);
        if (event === 'PASSWORD_RECOVERY') {
          setPasswordRecovery(true);
        }
      }
    );

    async function handleAuthUrl(url: string | null) {
      if (!url || !mounted) return;
      try {
        const created = await createSessionFromUrl(url);
        if (created) {
          const params = getParamsFromUrl(url);
          if (
            params.type === 'recovery' ||
            url.includes('reset-password') ||
            url.includes('type=recovery')
          ) {
            setPasswordRecovery(true);
          }
        }
      } catch {
        // Ignore non-auth deep links
      }
    }

    void Linking.getInitialURL().then(handleAuthUrl);
    const linkSub = Linking.addEventListener('url', ({ url }) => {
      void handleAuthUrl(url);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
      linkSub.remove();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setPasswordRecovery(false);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const redirectTo = getPasswordResetRedirectUrl();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    setPasswordRecovery(false);
  }, []);

  const clearPasswordRecovery = useCallback(() => {
    setPasswordRecovery(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      configured: isSupabaseConfigured,
      passwordRecovery,
      signIn,
      signUp,
      signOut,
      resetPassword,
      updatePassword,
      clearPasswordRecovery,
    }),
    [
      session,
      loading,
      passwordRecovery,
      signIn,
      signUp,
      signOut,
      resetPassword,
      updatePassword,
      clearPasswordRecovery,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
