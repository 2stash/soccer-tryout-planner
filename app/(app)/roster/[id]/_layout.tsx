import { Stack, useLocalSearchParams } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { RosterSubnav } from '@/components/RosterSubnav';
import { ActiveRoleProvider } from '@/lib/ActiveRoleContext';
import { MasterConflictProvider } from '@/lib/MasterConflictContext';
import { RosterDataProvider } from '@/lib/RosterDataContext';
import { colors } from '@/constants/theme';

export default function RosterLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();

  if (!id) {
    return (
      <View style={styles.wrap}>
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
    <ActiveRoleProvider rosterId={id}>
      <MasterConflictProvider>
        <RosterDataProvider rosterId={id}>
          <View style={styles.wrap}>
            <RosterSubnav rosterId={id} />
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
              <Stack.Screen name="planner" />
              <Stack.Screen name="add" />
              <Stack.Screen name="import" />
              <Stack.Screen name="team" />
            </Stack>
          </View>
        </RosterDataProvider>
      </MasterConflictProvider>
    </ActiveRoleProvider>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
