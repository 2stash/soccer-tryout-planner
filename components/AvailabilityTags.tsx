import { StyleSheet, Text, View } from 'react-native';
import { useMasterConflicts } from '@/lib/MasterConflictContext';
import { colors } from '@/constants/theme';

type Props = {
  playerId: string;
  compact?: boolean;
};

/** "On JV" / "On Fr" tags for Available/Unavailable when claimed elsewhere. */
export function AvailabilityTags({ playerId, compact = false }: Props) {
  const { availabilityTagsFor } = useMasterConflicts();
  const tags = availabilityTagsFor(playerId);
  if (tags.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text
        style={[styles.chip, compact && styles.chipCompact]}
        numberOfLines={1}
      >
        {tags.join(' · ')}
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
