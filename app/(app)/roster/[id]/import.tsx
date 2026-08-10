import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { ImportSheet } from '@/components/ImportSheet';
import { useOffline } from '@/lib/offline/OfflineContext';
import { colors } from '@/constants/theme';

function leaveImportScreen(rosterId: string | undefined) {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  if (rosterId) router.replace(`/roster/${rosterId}`);
}

export default function ImportPlayersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, loading, configured } = useAuth();
  const { isOnline } = useOffline();

  if (!loading && (!configured || !session)) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (!id) {
    return null;
  }

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Import players</Text>
        <Pressable
          onPress={() => leaveImportScreen(id)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Cancel import"
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
      <Text style={styles.sub}>
        Preview mapped columns, then confirm to insert players into this team.
        {Platform.OS === 'ios'
          ? ' On iPhone, use Scan photo for a printed Last, First + class list.'
          : ''}
      </Text>
      {!isOnline ? (
        <Text style={styles.offlineNote}>
          Import requires a network connection. Come back online to upload a
          spreadsheet.
        </Text>
      ) : (
        <View style={styles.sheet}>
          <ImportSheet
            rosterId={id}
            onImported={() => leaveImportScreen(id)}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 20,
    paddingBottom: 8,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  heading: {
    flex: 1,
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  cancelText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 16,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  sub: {
    color: colors.muted,
  },
  sheet: {
    flex: 1,
    minHeight: 0,
  },
  offlineNote: {
    color: colors.danger,
    fontWeight: '600',
    marginTop: 8,
  },
});
