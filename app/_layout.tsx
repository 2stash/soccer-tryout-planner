import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/lib/AuthContext';
import { colors } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

export { ErrorBoundary } from 'expo-router';

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)/sign-in" options={{ title: 'Sign in' }} />
          <Stack.Screen
            name="(auth)/reset-password"
            options={{ title: 'Reset password', headerBackVisible: false }}
          />
          <Stack.Screen
            name="(app)/dashboard"
            options={{ title: 'Dashboard', headerBackVisible: false }}
          />
          <Stack.Screen
            name="(app)/roster/[id]"
            options={{ headerShown: false }}
          />
          <Stack.Screen name="player/[id]" options={{ title: 'Player' }} />
          <Stack.Screen name="+not-found" />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
