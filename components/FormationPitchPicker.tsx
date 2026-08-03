import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { FormationSlot } from '@/lib/formation';
import { FORMATION_442_VERTICAL } from '@/lib/formation';
import {
  getDepthPositionGroup,
  getPosition,
  type PositionNumber,
} from '@/lib/positions';
import { colors } from '@/constants/theme';

type Props = {
  selected?: PositionNumber | number;
  onSelect?: (position: PositionNumber) => void;
  slots?: FormationSlot[];
  /**
   * When provided, each node shows this label (e.g. last name) instead of
   * position abbr + shirt number. Null/missing → "—".
   */
  labelByNumber?: Partial<Record<number, string | null>>;
  /** Smaller pitch/nodes for phone game-day view. */
  density?: 'default' | 'compact';
};

const NODE = 52;
const NAME_NODE = 64;
const NODE_COMPACT = 44;
const NAME_NODE_COMPACT = 52;

export function FormationPitchPicker({
  selected,
  onSelect,
  slots = FORMATION_442_VERTICAL,
  labelByNumber,
  density = 'default',
}: Props) {
  const showNames = labelByNumber != null;
  const compact = density === 'compact';
  const selectedGroup =
    selected != null ? getDepthPositionGroup(selected) : [];
  const nodeSize = showNames
    ? compact
      ? NAME_NODE_COMPACT
      : NAME_NODE
    : compact
      ? NODE_COMPACT
      : NODE;

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <Text style={styles.formationLabel}>4-4-2</Text>
      <View style={[styles.pitch, compact && styles.pitchCompact]}>
        <View style={styles.grass} />
        <View style={[styles.line, styles.halfway]} />
        <View
          style={[styles.centerCircle, compact && styles.centerCircleCompact]}
        />
        <View style={[styles.box, styles.boxTop]} />
        <View style={[styles.box, styles.boxBottom]} />
        <View style={[styles.six, styles.sixTop]} />
        <View style={[styles.six, styles.sixBottom]} />

        {slots.map((slot) => {
          const pos = getPosition(slot.number);
          const active =
            !showNames && selectedGroup.includes(slot.number);
          const nameLabel = showNames
            ? (labelByNumber[slot.number] ?? null)
            : null;
          const filled = Boolean(nameLabel);
          const content = (
            <>
              {showNames ? (
                <Text
                  style={[
                    styles.name,
                    compact && styles.nameCompact,
                    !filled && styles.nameEmpty,
                  ]}
                  numberOfLines={2}
                >
                  {nameLabel || '—'}
                </Text>
              ) : (
                <>
                  <Text style={[styles.abbr, active && styles.textActive]}>
                    {pos?.abbr ?? slot.number}
                  </Text>
                  <Text style={[styles.num, active && styles.textActive]}>
                    {slot.number}
                  </Text>
                </>
              )}
            </>
          );

          const positionStyle = {
            left: `${slot.x * 100}%` as `${number}%`,
            top: `${slot.y * 100}%` as `${number}%`,
            width: nodeSize,
            height: nodeSize,
            marginLeft: -(nodeSize / 2),
            marginTop: -(nodeSize / 2),
            borderRadius: nodeSize / 2,
          };

          if (!onSelect || showNames) {
            return (
              <View
                key={slot.number}
                style={[
                  styles.node,
                  showNames && styles.nodeName,
                  compact && styles.nodeCompact,
                  positionStyle,
                  showNames && filled && styles.nodeFilled,
                  showNames && !filled && styles.nodeVacant,
                ]}
              >
                {content}
              </View>
            );
          }

          return (
            <Pressable
              key={slot.number}
              style={[
                styles.node,
                compact && styles.nodeCompact,
                positionStyle,
                active && styles.nodeActive,
              ]}
              onPress={() => onSelect(slot.number)}
            >
              {content}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: 10,
    gap: 8,
  },
  wrapCompact: {
    padding: 4,
    gap: 4,
  },
  formationLabel: {
    textAlign: 'center',
    fontWeight: '800',
    fontSize: 12,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  pitch: {
    width: '100%',
    aspectRatio: 0.62,
    minHeight: 420,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#1f5c3a',
    position: 'relative',
    backgroundColor: '#1a6b3c',
  },
  pitchCompact: {
    minHeight: 0,
    aspectRatio: 0.68,
    borderRadius: 8,
  },
  grass: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1f7a45',
  },
  line: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  halfway: {
    left: 10,
    right: 10,
    top: '50%',
    height: 2,
    marginTop: -1,
  },
  centerCircle: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 56,
    height: 56,
    marginLeft: -28,
    marginTop: -28,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  centerCircleCompact: {
    width: 40,
    height: 40,
    marginLeft: -20,
    marginTop: -20,
    borderRadius: 20,
  },
  box: {
    position: 'absolute',
    left: '18%',
    right: '18%',
    height: '14%',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  boxTop: {
    top: 0,
    borderTopWidth: 0,
  },
  boxBottom: {
    bottom: 0,
    borderBottomWidth: 0,
  },
  six: {
    position: 'absolute',
    left: '30%',
    right: '30%',
    height: '7%',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  sixTop: {
    top: 0,
    borderTopWidth: 0,
  },
  sixBottom: {
    bottom: 0,
    borderBottomWidth: 0,
  },
  node: {
    position: 'absolute',
    backgroundColor: 'rgba(18, 28, 38, 0.9)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  nodeCompact: {
    paddingHorizontal: 3,
    borderWidth: 1.5,
  },
  nodeName: {
    paddingHorizontal: 6,
  },
  nodeFilled: {
    backgroundColor: 'rgba(18, 28, 38, 0.92)',
    borderColor: 'rgba(255,255,255,0.55)',
  },
  nodeVacant: {
    backgroundColor: 'rgba(18, 28, 38, 0.45)',
    borderColor: 'rgba(255,255,255,0.25)',
    borderStyle: 'dashed',
  },
  nodeActive: {
    backgroundColor: colors.primary,
    borderColor: '#9ae6c0',
    transform: [{ scale: 1.08 }],
  },
  abbr: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 12,
  },
  num: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 10,
    fontWeight: '700',
    marginTop: -1,
  },
  name: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 13,
  },
  nameCompact: {
    fontSize: 10,
    lineHeight: 11,
  },
  nameEmpty: {
    color: 'rgba(255,255,255,0.45)',
    fontWeight: '600',
  },
  textActive: {
    color: colors.primaryText,
  },
});
