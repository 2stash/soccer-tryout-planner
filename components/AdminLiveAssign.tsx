import { Text, View } from 'react-native';

/**
 * Removed: Admin Live overlay no longer exists (single shared workspace).
 * Kept as a stub so any stale import fails loudly in UI rather than at compile.
 */
export function AdminLiveAssign() {
  return (
    <View style={{ padding: 16 }}>
      <Text>Admin Live has been removed. Use Assign on the shared roster.</Text>
    </View>
  );
}
