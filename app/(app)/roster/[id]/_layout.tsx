import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineConflictModal } from '@/components/OfflineConflictModal';
import { RosterSubnav } from '@/components/RosterSubnav';
import { ActiveRoleProvider } from '@/lib/ActiveRoleContext';
import { MasterConflictProvider } from '@/lib/MasterConflictContext';
import {
  OfflineProvider,
  useOffline,
} from '@/lib/offline/OfflineContext';
import { RosterDataProvider } from '@/lib/RosterDataContext';
import { colors } from '@/constants/theme';

function OfflineConflictHost() {
  const {
    conflictVisible,
    conflictRosterName,
    conflictBusy,
    conflictError,
    resolveConflict,
  } = useOffline();
  return (
    <OfflineConflictModal
      visible={conflictVisible}
      rosterName={conflictRosterName}
      busy={conflictBusy}
      error={conflictError}
      onResolve={(choice) => {
        void resolveConflict(choice);
      }}
    />
  );
}

export default function RosterLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  // Landscape Dynamic Island / notch sits on the left or right edge.
  const safePadStyle = {
    paddingLeft: Math.max(insets.left, 0),
    paddingRight: Math.max(insets.right, 0),
  };

  if (!id) {
    return (
      <View style={[styles.wrap, safePadStyle]}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
      </View>
    );
  }

  return (
    <ActiveRoleProvider key={id} rosterId={id}>
      <OfflineProvider>
        <MasterConflictProvider>
          <RosterDataProvider rosterId={id}>
            <View style={[styles.wrap, safePadStyle]}>
              <RosterSubnav rosterId={id} />
              <OfflineConflictHost />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.bg },
                }}
              >
                <Stack.Screen name="index" />
                <Stack.Screen name="depth" />
                <Stack.Screen name="rosters" />
                <Stack.Screen name="assign" />
                <Stack.Screen name="players" />
                <Stack.Screen name="planner" />
                <Stack.Screen name="add" />
                <Stack.Screen name="import" />
                <Stack.Screen name="team" />
              </Stack>
            </View>
          </RosterDataProvider>
        </MasterConflictProvider>
      </OfflineProvider>
    </ActiveRoleProvider>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
