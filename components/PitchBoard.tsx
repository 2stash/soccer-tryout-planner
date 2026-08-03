import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Player } from '@/lib/types';
import type { FormationSlot } from '@/lib/formation';
import { FORMATION_433, slotTitle } from '@/lib/formation';
import {
  playersForBoardSlot,
  type DepthChartEntry,
} from '@/lib/depthChart';
import {
  getDepthCanonicalPosition,
  type PositionNumber,
} from '@/lib/positions';

type Props = {
  slots?: FormationSlot[];
  /** Players already filtered to the active squad team. */
  squadPlayers: Player[];
  /** Depth chart rows for this squad — same source as Depth / All Players. */
  depthEntries: DepthChartEntry[];
  onRemoveFromSlot: (player: Player, slotNumber: number) => void;
  /** Smaller board for tablet / narrower windows. */
  density?: 'default' | 'compact';
};

/** Visible player rows before the card list scrolls (keeps neighbors from overlapping). */
const MAX_VISIBLE_ROWS = 4;

function boardCardTitle(number: PositionNumber, count: number) {
  return count > 0 ? `${slotTitle(number)} · ${count}` : slotTitle(number);
}

export function PitchBoard({
  slots = FORMATION_433,
  squadPlayers,
  depthEntries,
  onRemoveFromSlot,
  density = 'default',
}: Props) {
  const compact = density === 'compact';
  const cardW = compact ? CARD_W_COMPACT : CARD_W;
  const rowH = compact ? ROW_H_COMPACT : ROW_H;
  const headerH = compact ? HEADER_H_COMPACT : HEADER_H;
  const listMaxH = MAX_VISIBLE_ROWS * rowH;
  const cardMaxH = headerH + listMaxH + (compact ? 10 : 14);

  const slotLists = slots.map((slot) =>
    playersForBoardSlot(squadPlayers, depthEntries, slot.number)
  );
  const deepest = slotLists.length
    ? Math.max(...slotLists.map((list) => list.length))
    : 0;
  const basePitchH = compact ? PITCH_H_COMPACT : PITCH_H;
  const pitchH = basePitchH + Math.max(0, deepest - MAX_VISIBLE_ROWS) * 18;

  return (
    <View
      style={[
        styles.pitch,
        compact && styles.pitchCompact,
        { height: pitchH, minHeight: pitchH },
      ]}
    >
      <View style={styles.grass} />
      <View style={[styles.line, styles.halfway]} />
      <View
        style={[styles.centerCircle, compact && styles.centerCircleCompact]}
      />
      <View style={[styles.box, styles.boxLeft]} />
      <View style={[styles.box, styles.boxRight]} />
      <View style={[styles.six, styles.sixLeft]} />
      <View style={[styles.six, styles.sixRight]} />

      <Text style={styles.directionHint}>GK ← field → ST</Text>

      {slots.map((slot, slotIndex) => {
        const inSlot = slotLists[slotIndex];
        const removeNumber = getDepthCanonicalPosition(slot.number);
        const needsScroll = inSlot.length > MAX_VISIBLE_ROWS;

        return (
          <View
            key={slot.number}
            style={[
              styles.card,
              compact && styles.cardCompact,
              {
                left: `${slot.x * 100}%`,
                top: `${slot.y * 100}%`,
                width: cardW,
                marginLeft: -(cardW / 2),
                marginTop: -(cardMaxH / 2),
                maxHeight: cardMaxH,
              },
            ]}
          >
            <View
              style={[styles.cardHeader, compact && styles.cardHeaderCompact]}
            >
              <Text style={styles.cardTitle} numberOfLines={1}>
                {boardCardTitle(slot.number, inSlot.length)}
              </Text>
            </View>

            {inSlot.length === 0 ? (
              <Text style={styles.emptySlot}>Empty</Text>
            ) : (
              <ScrollView
                style={{ maxHeight: listMaxH }}
                contentContainerStyle={styles.listContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator={needsScroll}
              >
                {inSlot.map((player, index) => (
                  <View
                    key={`${slot.number}-${player.id}`}
                    style={[
                      styles.playerRow,
                      { minHeight: rowH, height: rowH },
                    ]}
                  >
                    <Text style={styles.depth}>{index + 1}</Text>
                    <Text style={styles.playerName} numberOfLines={1}>
                      {player.last_name}
                      {player.first_name
                        ? `, ${player.first_name.charAt(0)}.`
                        : ''}
                    </Text>
                    <Pressable
                      hitSlop={6}
                      onPress={() => onRemoveFromSlot(player, removeNumber)}
                      style={styles.removeBtn}
                    >
                      <Text style={styles.removeText}>−</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        );
      })}
    </View>
  );
}

const CARD_W = 132;
const CARD_W_COMPACT = 112;
const ROW_H = 22;
const ROW_H_COMPACT = 20;
const HEADER_H = 26;
const HEADER_H_COMPACT = 22;
const PITCH_H = 620;
const PITCH_H_COMPACT = 520;

const styles = StyleSheet.create({
  pitch: {
    width: '100%',
    minWidth: 920,
    height: PITCH_H,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#1f5c3a',
    position: 'relative',
    backgroundColor: '#1a6b3c',
  },
  pitchCompact: {
    minWidth: 780,
    height: PITCH_H_COMPACT,
  },
  grass: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1f7a45',
    opacity: 0.9,
  },
  line: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  halfway: {
    left: '50%',
    top: 12,
    bottom: 12,
    width: 2,
    marginLeft: -1,
  },
  centerCircle: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 90,
    height: 90,
    marginLeft: -45,
    marginTop: -45,
    borderRadius: 45,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  centerCircleCompact: {
    width: 70,
    height: 70,
    marginLeft: -35,
    marginTop: -35,
    borderRadius: 35,
  },
  box: {
    position: 'absolute',
    top: '22%',
    bottom: '22%',
    width: '12%',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  boxLeft: {
    left: 0,
    borderLeftWidth: 0,
  },
  boxRight: {
    right: 0,
    borderRightWidth: 0,
  },
  six: {
    position: 'absolute',
    top: '34%',
    bottom: '34%',
    width: '5%',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  sixLeft: {
    left: 0,
    borderLeftWidth: 0,
  },
  sixRight: {
    right: 0,
    borderRightWidth: 0,
  },
  directionHint: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  card: {
    position: 'absolute',
    backgroundColor: 'rgba(18, 28, 38, 0.94)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 4,
    overflow: 'hidden',
  },
  cardCompact: {
    paddingHorizontal: 5,
    paddingTop: 3,
    paddingBottom: 3,
  },
  cardHeader: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    paddingBottom: 3,
    marginBottom: 2,
    minHeight: HEADER_H - 8,
    justifyContent: 'center',
  },
  cardHeaderCompact: {
    minHeight: HEADER_H_COMPACT - 6,
    paddingBottom: 2,
    marginBottom: 1,
  },
  cardTitle: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 12,
  },
  emptySlot: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    paddingVertical: 6,
  },
  listContent: {
    paddingBottom: 2,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  depth: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    width: 14,
    fontWeight: '700',
  },
  playerName: {
    flex: 1,
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  removeBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: {
    color: '#f5a3a3',
    fontWeight: '800',
    fontSize: 13,
    lineHeight: 14,
  },
});
