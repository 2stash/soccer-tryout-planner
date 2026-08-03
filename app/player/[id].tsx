import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { deletePlayer, getPlayer, updatePlayer } from '@/lib/players';
import type { Player } from '@/lib/types';
import { PlayerForm } from '@/components/PlayerForm';
import { colors } from '@/constants/theme';

export default function PlayerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, loading, configured } = useAuth();
  const [player, setPlayer] = useState<Player | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoadingData(true);
    setError(null);
    try {
      const data = await getPlayer(id);
      setPlayer(data);
      if (!data) setError('Player not found');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load player');
    } finally {
      setLoadingData(false);
    }
  }, [id]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  if (!loading && (!configured || !session)) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  async function handleDelete() {
    if (!player) return;

    const confirmDelete = async () => {
      try {
        await deletePlayer(player.id);
        if (Platform.OS === 'web' && typeof window !== 'undefined' && window.opener) {
          window.close();
          return;
        }
        router.replace(`/roster/${player.roster_id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to delete player');
      }
    };

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`Delete ${player.first_name} ${player.last_name}?`)) {
        await confirmDelete();
      }
      return;
    }

    Alert.alert(
      'Delete player',
      `Delete ${player.first_name} ${player.last_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void confirmDelete() },
      ]
    );
  }

  const title = player
    ? `${player.first_name} ${player.last_name}`
    : 'Player';

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title,
          headerRight: () =>
            player ? (
              <Pressable onPress={() => void handleDelete()}>
                <Text style={styles.deleteLink}>Delete</Text>
              </Pressable>
            ) : null,
        }}
      />

      {loadingData ? (
        <ActivityIndicator color={colors.primary} />
      ) : player ? (
        <>
          <Text style={styles.heading}>{title}</Text>
          <Text style={styles.sub}>Edit details — changes sync to other open windows.</Text>
          {savedMsg ? <Text style={styles.saved}>{savedMsg}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PlayerForm
            initial={player}
            submitLabel="Save changes"
            onSubmit={async (value) => {
              const updated = await updatePlayer(player.id, value);
              setPlayer(updated);
              setSavedMsg('Saved');
              setTimeout(() => setSavedMsg(null), 2000);
            }}
          />
          <Pressable
            style={styles.backBtn}
            onPress={() => router.push(`/roster/${player.roster_id}`)}
          >
            <Text style={styles.backText}>Back to roster</Text>
          </Pressable>
        </>
      ) : (
        <Text style={styles.error}>{error ?? 'Player not found'}</Text>
      )}
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
    marginBottom: 4,
  },
  saved: {
    color: colors.primary,
    fontWeight: '600',
  },
  error: {
    color: colors.danger,
  },
  deleteLink: {
    color: colors.danger,
    fontWeight: '600',
    marginRight: 8,
  },
  backBtn: {
    alignSelf: 'flex-start',
    marginTop: 12,
  },
  backText: {
    color: colors.primary,
    fontWeight: '600',
  },
});
