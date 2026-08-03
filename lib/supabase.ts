import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured =
  Boolean(supabaseUrl) &&
  Boolean(supabaseAnonKey) &&
  !supabaseUrl.includes('your-project') &&
  !supabaseAnonKey.includes('your-anon-key');

const storage =
  Platform.OS === 'web'
    ? {
        getItem: (key: string) => {
          if (typeof localStorage === 'undefined') return null;
          return localStorage.getItem(key);
        },
        setItem: (key: string, value: string) => {
          if (typeof localStorage === 'undefined') return;
          localStorage.setItem(key, value);
        },
        removeItem: (key: string) => {
          if (typeof localStorage === 'undefined') return;
          localStorage.removeItem(key);
        },
      }
    : AsyncStorage;

export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  }
);
