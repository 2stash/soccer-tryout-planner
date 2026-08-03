import { StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { createPlayer } from '@/lib/players';
import { PlayerForm } from '@/components/PlayerForm';
import { colors } from '@/constants/theme';

export default function AddPlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, loading, configured } = useAuth();

  if (!loading && (!configured || !session)) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Add player</Text>
      <Text style={styles.sub}>Enter player details for this team.</Text>
      <PlayerForm
        submitLabel="Add player"
        onCancel={() => {
          if (id) router.replace(`/roster/${id}`);
        }}
        onSubmit={async (value) => {
          if (!id) return;
          await createPlayer(id, value);
          router.replace(`/roster/${id}`);
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
});
