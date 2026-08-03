import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '@/lib/AuthContext';
import { colors } from '@/constants/theme';

export default function Index() {
  const { session, loading, configured, passwordRecovery } = useAuth();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!configured || !session) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (passwordRecovery) {
    return <Redirect href="/(auth)/reset-password" />;
  }

  return <Redirect href="/dashboard" />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
});
