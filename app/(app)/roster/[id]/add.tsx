import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <Pressable onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.content}>
            <Text style={styles.heading}>Add player</Text>
            <Text style={styles.sub}>Enter player details for this team.</Text>
            {!isOnline ? (
              <Text style={styles.offlineNote}>
                Adding players requires a network connection.
              </Text>
            ) : null}
            <PlayerForm
              submitLabel="Add player"
              onCancel={() => {
                Keyboard.dismiss();
                leaveAddScreen(id);
              }}
              onSubmit={async (value) => {
                if (!id) return;
                if (!isOnline) {
                  alertRequiresOnline('Adding players');
                  return;
                }
                Keyboard.dismiss();
                await createPlayer(id, value);
                leaveAddScreen(id);
              }}
            />
          </View>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 40,
  },
  content: {
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
