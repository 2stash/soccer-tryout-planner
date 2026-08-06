import { StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { alertRequiresOnline } from '@/lib/offline/gate';
import { useOffline } from '@/lib/offline/OfflineContext';
import { createPlayer } from '@/lib/players';
import { PlayerForm } from '@/components/PlayerForm';
import { colors } from '@/constants/theme';

function leaveAddScreen(rosterId: string | undefined) {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  if (rosterId) router.replace(`/roster/${rosterId}`);
}

export default function AddPlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, loading, configured } = useAuth();
  const { isOnline } = useOffline();

  if (!loading && (!configured || !session)) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Add player</Text>
      <Text style={styles.sub}>Enter player details for this team.</Text>
      {!isOnline ? (
        <Text style={styles.offlineNote}>
          Adding players requires a network connection.
        </Text>
      ) : null}
      <PlayerForm
        submitLabel="Add player"
        onCancel={() => leaveAddScreen(id)}
        onSubmit={async (value) => {
          if (!id) return;
          if (!isOnline) {
            alertRequiresOnline('Adding players');
            return;
          }
          await createPlayer(id, value);
          leaveAddScreen(id);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 20,
    gap: 10,
  },
  heading: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  sub: {
    color: colors.muted,
    marginBottom: 8,
  },
  offlineNote: {
    color: colors.danger,
    fontWeight: '600',
    marginBottom: 4,
  },
});
