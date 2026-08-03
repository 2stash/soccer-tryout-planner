import { StyleSheet, Text, View } from 'react-native';
import { useActiveRole } from '@/lib/ActiveRoleContext';
import { useMasterConflicts } from '@/lib/MasterConflictContext';
import { colors } from '@/constants/theme';

type Props = {
  playerId: string;
  /** Prefix each label with "Also " (default true). */
  alsoPrefix?: boolean;
  compact?: boolean;
};

export function MasterConflictChips({
  playerId,
  alsoPrefix = true,
  compact = false,
}: Props) {
  const { isAdminLiveMode } = useActiveRole();
  const { labelsFor } = useMasterConflicts();
  const labels = labelsFor(playerId);
  if (labels.length === 0) return null;

  // Admin Live lists every claiming team; skip "Also" prefix.
  const text =
    alsoPrefix && !isAdminLiveMode
      ? labels.map((l) => `Also ${l}`).join(' · ')
      : labels.join(' · ');

  return (
    <View style={styles.wrap}>
      <Text
        style={[styles.chip, compact && styles.chipCompact]}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 2,
    alignSelf: 'flex-start',
  },
  chip: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.warningText,
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: '#e0c36a',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  chipCompact: {
    fontSize: 10,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
});
