import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Player, PlayerAssignment, PlayerInput, SquadTeam } from '@/lib/types';
import { normalizeSchoolYear } from '@/lib/schoolYear';
import {
  formatPositionsShort,
  normalizePositions,
  positionsEqual,
} from '@/lib/positions';
import { PositionSelect } from '@/components/PositionSelect';
import { SquadSelect } from '@/components/SquadSelect';
import { useRosterData } from '@/lib/RosterDataContext';
import { playerAttendedAnyTryout } from '@/lib/tryout';
import { colors, layout } from '@/constants/theme';

type Props = {
  players: Player[];
  canReorder: boolean;
  /** Top N players are starters (CB uses 2). Use 0 for a subs-only list. */
  starterCount?: number;
  /** Display-only rank start (depth = 1, squad subs = 12). */
  rankStart?: number;
  /** When false, hides the Starter/Sub role column. */
  showRole?: boolean;
  emptyText?: string;
  /** Player id → position abbreviations they start at elsewhere. */
  starterElsewhereByPlayer?: Record<string, string[]>;
  /**
   * Phone: dense cards (tap to edit) instead of the inline table.
   * Requires `onPressPlayer`.
   */
  compact?: boolean;
  onPressPlayer?: (player: Player) => void;
  /** Desktop/iPad: change positions (name/year stay read-only). */
  onSave: (id: string, input: PlayerInput) => Promise<void>;
  /** Desktop/iPad: change team assignment. */
  onAssignSquad?: (
    playerId: string,
    team: PlayerAssignment | null
  ) => Promise<void>;
  onMove: (playerId: string, direction: 'up' | 'down') => Promise<void>;
};

export function DepthPositionList({
  players,
  canReorder,
  starterCount = 1,
  rankStart = 1,
  showRole = true,
  emptyText = 'No players at this position for this filter.',
  starterElsewhereByPlayer = {},
  compact = false,
  onPressPlayer,
  onSave,
  onAssignSquad,
  onMove,
}: Props) {
  if (players.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{emptyText}</Text>
      </View>
    );
  }

  if (compact) {
    return (
      <View style={styles.cardList}>
        {players.map((player, index) => (
          <DepthCard
            key={player.id}
            player={player}
            index={index}
            rank={rankStart + index}
            isLast={index === players.length - 1}
            isStarter={index < starterCount}
            canReorder={canReorder}
            showRole={showRole}
            starterElsewhere={
              showRole ? starterElsewhereByPlayer[player.id] ?? [] : []
            }
            onPress={
              onPressPlayer ? () => onPressPlayer(player) : undefined
            }
            onMove={onMove}
          />
        ))}
      </View>
    );
  }

  const showTeam = Boolean(onAssignSquad);

  return (
    <View style={styles.table}>
      <View style={[styles.row, styles.headerRow]}>
        <Text style={[styles.headerText, styles.rankCol]}>#</Text>
        {canReorder ? <View style={styles.orderCol} /> : null}
        {showRole ? <Text style={[styles.headerText, styles.roleCol]}>Role</Text> : null}
        {showRole ? <View style={styles.starCol} /> : null}
        <Text style={[styles.headerText, styles.nameCol]}>Name</Text>
        <Text style={[styles.headerText, styles.yearCol]}>Year</Text>
        <Text style={[styles.headerText, styles.posCol]}>Positions</Text>
        {showTeam ? (
          <Text style={[styles.headerText, styles.teamCol]}>Team</Text>
        ) : null}
      </View>
      {players.map((player, index) => (
        <DepthRow
          key={player.id}
          player={player}
          index={index}
          rank={rankStart + index}
          isLast={index === players.length - 1}
          isStarter={index < starterCount}
          canReorder={canReorder}
          showRole={showRole}
          showTeam={showTeam}
          starterElsewhere={
            showRole ? starterElsewhereByPlayer[player.id] ?? [] : []
          }
          onSave={onSave}
          onAssignSquad={onAssignSquad}
          onMove={onMove}
        />
      ))}
    </View>
  );
}

function DepthCard({
  player,
  index,
  rank,
  isLast,
  isStarter,
  canReorder,
  showRole,
  starterElsewhere,
  onPress,
  onMove,
}: {
  player: Player;
  index: number;
  rank: number;
  isLast: boolean;
  isStarter: boolean;
  canReorder: boolean;
  showRole: boolean;
  starterElsewhere: string[];
  onPress?: () => void;
  onMove: (playerId: string, direction: 'up' | 'down') => Promise<void>;
}) {
  const { roster } = useRosterData();
  const present =
    Boolean(roster?.tryout_active) && playerAttendedAnyTryout(player);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const pos = formatPositionsShort(player.positions);
  const elsewhere =
    starterElsewhere.length > 0 ? `★ ${starterElsewhere.join(', ')}` : null;
  const roleLabel = isStarter ? 'Starter' : 'Sub';

  async function handleMove(direction: 'up' | 'down') {
    setMoving(true);
    setMoveError(null);
    try {
      await onMove(player.id, direction);
    } catch (e) {
      setMoveError(e instanceof Error ? e.message : 'Reorder failed');
    } finally {
      setMoving(false);
    }
  }

  return (
    <View style={styles.cardWrap}>
    <View
      style={[
        styles.card,
        isStarter && showRole && styles.cardStarter,
        present && styles.cardPresent,
        moving && styles.rowBusy,
      ]}
    >
      <Pressable
        style={styles.cardMain}
        onPress={onPress}
        disabled={!onPress}
      >
        <View style={styles.cardTop}>
          <Text
            style={[styles.cardRank, isStarter && showRole && styles.cardRankStarter]}
            numberOfLines={1}
          >
            {showRole ? roleLabel : `#${rank}`}
          </Text>
          {showRole ? (
            <Text style={styles.cardRankNum} numberOfLines={1}>
              #{rank}
            </Text>
          ) : null}
          {elsewhere ? (
            <Text style={styles.cardStar} numberOfLines={1}>
              {elsewhere}
            </Text>
          ) : null}
        </View>
        <Text style={styles.cardName} numberOfLines={1}>
          {player.last_name}, {player.first_name}
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {[player.school_year, pos || 'No pos'].filter(Boolean).join(' · ')}
        </Text>
      </Pressable>
      {canReorder ? (
        <View style={styles.cardMoveCol}>
          <Pressable
            style={[styles.cardMoveBtn, index === 0 && styles.moveDisabled]}
            disabled={index === 0 || moving}
            onPress={() => void handleMove('up')}
            hitSlop={6}
          >
            <Text style={styles.moveText}>↑</Text>
          </Pressable>
          <Pressable
            style={[styles.cardMoveBtn, isLast && styles.moveDisabled]}
            disabled={isLast || moving}
            onPress={() => void handleMove('down')}
            hitSlop={6}
          >
            <Text style={styles.moveText}>↓</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
    {moveError ? <Text style={styles.cardError}>{moveError}</Text> : null}
    </View>
  );
}

function StarterElsewhereStar({
  positions,
  visible,
}: {
  positions: string[];
  visible: boolean;
}) {
  const [hover, setHover] = useState(false);
  if (!visible) return null;
  if (positions.length === 0) {
    return <View style={styles.starCol} />;
  }

  const list = positions.join(', ');
  const tooltip =
    positions.length === 1
      ? `This player is a starter at another position: ${list}`
      : `This player is a starter at other positions: ${list}`;

  const hoverHandlers =
    Platform.OS === 'web'
      ? {
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
        }
      : {};

  return (
    <View style={styles.starCol}>
      <View
        style={styles.starHit}
        accessibilityLabel={tooltip}
        // @ts-expect-error web title tooltip
        title={tooltip}
        {...hoverHandlers}
      >
        <Text style={styles.star}>★</Text>
        {hover ? (
          <View style={styles.tooltip} pointerEvents="none">
            <Text style={styles.tooltipText}>{tooltip}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function DepthRow({
  player,
  index,
  rank,
  isLast,
  isStarter,
  canReorder,
  showRole,
  showTeam,
  starterElsewhere,
  onSave,
  onAssignSquad,
  onMove,
}: {
  player: Player;
  index: number;
  rank: number;
  isLast: boolean;
  isStarter: boolean;
  canReorder: boolean;
  showRole: boolean;
  showTeam: boolean;
  starterElsewhere: string[];
  onSave: (id: string, input: PlayerInput) => Promise<void>;
  onAssignSquad?: (
    playerId: string,
    team: PlayerAssignment | null
  ) => Promise<void>;
  onMove: (playerId: string, direction: 'up' | 'down') => Promise<void>;
}) {
  const { roster } = useRosterData();
  const present =
    Boolean(roster?.tryout_active) && playerAttendedAnyTryout(player);
  const [positions, setPositions] = useState(() =>
    normalizePositions(player.positions)
  );
  const baselineRef = useRef(normalizePositions(player.positions));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    const next = normalizePositions(player.positions);
    setPositions((current) => {
      if (
        positionsEqual(current, baselineRef.current) ||
        positionsEqual(current, next)
      ) {
        baselineRef.current = next;
        return next;
      }
      return current;
    });
  }, [player.id, player.updated_at, player.positions]);

  async function commitPositions(nextPositions: number[]) {
    if (positionsEqual(nextPositions, baselineRef.current)) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(player.id, {
        first_name: player.first_name ?? '',
        last_name: player.last_name ?? '',
        school_year: normalizeSchoolYear(player.school_year),
        positions: nextPositions,
        position_rank: player.position_rank,
        team_rank: player.team_rank,
      });
      baselineRef.current = nextPositions;
      setPositions(nextPositions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleAssign(team: PlayerAssignment | null) {
    if (!onAssignSquad || team === player.squad_team) return;
    setSaving(true);
    setError(null);
    try {
      await onAssignSquad(player.id, team);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update team');
    } finally {
      setSaving(false);
    }
  }

  async function handleMove(direction: 'up' | 'down') {
    setMoving(true);
    setError(null);
    try {
      await onMove(player.id, direction);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reorder failed');
    } finally {
      setMoving(false);
    }
  }

  const role = isStarter ? 'Starter' : 'Sub';
  const year = normalizeSchoolYear(player.school_year) || '—';

  return (
    <View>
      <View
        style={[
          styles.row,
          isStarter && styles.starterRow,
          present && styles.presentRow,
          (saving || moving) && styles.rowBusy,
        ]}
      >
        <Text style={[styles.rankText, styles.rankCol, isStarter && styles.starterText]}>
          {rank}
        </Text>

        {canReorder ? (
          <View style={styles.orderCol}>
            <Pressable
              style={[styles.moveBtn, index === 0 && styles.moveDisabled]}
              disabled={index === 0 || moving || saving}
              onPress={() => void handleMove('up')}
            >
              <Text style={styles.moveText}>↑</Text>
            </Pressable>
            <Pressable
              style={[styles.moveBtn, isLast && styles.moveDisabled]}
              disabled={isLast || moving || saving}
              onPress={() => void handleMove('down')}
            >
              <Text style={styles.moveText}>↓</Text>
            </Pressable>
          </View>
        ) : null}

        {showRole ? (
          <Text style={[styles.roleText, styles.roleCol, isStarter && styles.starterText]}>
            {role}
          </Text>
        ) : null}

        <StarterElsewhereStar positions={starterElsewhere} visible={showRole} />

        <Text style={[styles.cellText, styles.nameCol]} numberOfLines={1}>
          {player.last_name}, {player.first_name}
        </Text>
        <Text style={[styles.cellText, styles.yearCol]} numberOfLines={1}>
          {year}
        </Text>
        <PositionSelect
          style={styles.posCol}
          compact
          value={positions}
          onChange={(next) => {
            setPositions(next);
            void commitPositions(next);
          }}
        />
        {showTeam ? (
          <SquadSelect
            compact
            style={styles.teamCol}
            value={player.squad_team}
            disabled={saving || moving}
            onChange={(team) => void handleAssign(team)}
          />
        ) : null}
      </View>
      {error ? <Text style={styles.rowError}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cardList: {
    gap: 8,
  },
  cardWrap: {
    gap: 4,
  },
  cardError: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.radius,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cardStarter: {
    backgroundColor: '#e8f5ef',
    borderColor: '#c5e4d4',
  },
  cardPresent: {
    backgroundColor: colors.tryoutPresentBg,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardRank: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
  },
  cardRankStarter: {
    color: colors.primary,
  },
  cardRankNum: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
  },
  cardStar: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '800',
    color: '#c9a227',
  },
  cardName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  cardMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  cardMoveCol: {
    gap: 4,
  },
  cardMoveBtn: {
    minWidth: 36,
    minHeight: 32,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: '#fbfcfd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    overflow: 'visible',
    backgroundColor: colors.surface,
    minWidth: 560,
    marginRight: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: 8,
    paddingRight: 16,
    gap: 4,
    overflow: 'visible',
    zIndex: 1,
  },
  headerRow: {
    backgroundColor: '#e8eef3',
    paddingVertical: 10,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    zIndex: 0,
  },
  starterRow: {
    backgroundColor: '#e8f5ef',
  },
  presentRow: {
    backgroundColor: colors.tryoutPresentBg,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  rowBusy: {
    opacity: 0.7,
  },
  headerText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    paddingHorizontal: 2,
  },
  rankCol: {
    width: 32,
    textAlign: 'center',
  },
  rankText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  orderCol: {
    width: 36,
    gap: 2,
    alignItems: 'center',
  },
  roleCol: {
    width: 58,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    paddingHorizontal: 2,
  },
  starCol: {
    width: 22,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  starHit: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 18,
    minHeight: 18,
  },
  star: {
    fontSize: 14,
    color: '#c9a227',
    fontWeight: '800',
  },
  tooltip: {
    position: 'absolute',
    left: 20,
    top: -6,
    backgroundColor: '#1f2933',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 180,
    maxWidth: 260,
    zIndex: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  tooltipText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  starterText: {
    color: colors.primary,
  },
  nameCol: {
    flexGrow: 0,
    flexShrink: 1,
    width: 140,
    minWidth: 100,
  },
  yearCol: {
    width: 64,
  },
  posCol: {
    flexGrow: 0,
    flexShrink: 1,
    width: 140,
    minWidth: 100,
  },
  teamCol: {
    width: 78,
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 78,
  },
  cellText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    paddingHorizontal: 2,
  },
  moveBtn: {
    width: 28,
    height: 22,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveDisabled: {
    opacity: 0.35,
  },
  moveText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
  },
  rowError: {
    color: colors.danger,
    fontSize: 12,
    paddingHorizontal: 12,
    paddingBottom: 6,
    backgroundColor: colors.dangerBg,
  },
  empty: {
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  emptyText: {
    color: colors.muted,
    textAlign: 'center',
  },
});
