import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { AvailabilityTags } from '@/components/AvailabilityTags';
import {
  availableRankMoveFlags,
  type GradeFilter,
} from '@/lib/availableRank';
import type { Player, SquadTeam } from '@/lib/types';
import { SQUAD_TEAMS, UNAVAILABLE_POOL } from '@/lib/types';
import type { SchoolYear } from '@/lib/schoolYear';
import {
  STARTER_DISPLAY_SLOTS,
  formatPositionsShort,
  playerInDepthGroup,
  type PositionNumber,
  type StarterDisplaySlot,
} from '@/lib/positions';
import type { SquadPlayerSection, SquadSectionRow } from '@/lib/squadSections';
import { useRosterData } from '@/lib/RosterDataContext';
import { playerAttendedAnyTryout } from '@/lib/tryout';
import { colors, layout } from '@/constants/theme';

export type StarterSlotPress = {
  squadTeam: SquadTeam;
  positionGroup: PositionNumber;
  slotIndex: number;
  label: string;
  player: Player | null;
  /** Phone: open one pane. Tablet/desktop omit (both). */
  pane?: 'edit' | 'swap' | 'both';
};

export type AvailableRankHandlers = {
  /** Ordered pool for ↑↓ / pin edges (grade-filtered, not text-search). */
  ordered: Player[];
  onMove: (player: Player, direction: 'up' | 'down') => void;
  onMoveTop: (player: Player) => void;
  onMoveBottom: (player: Player) => void;
  onTogglePin: (player: Player) => void;
  /** Assign Available player onto editable team(s). */
  onAddToTeam?: (player: Player, team: SquadTeam) => void;
  /** Teams shown as Add actions; one team → "Add to team" label. */
  addToTeams?: SquadTeam[];
  /**
   * Override add-button label. When set with a single addToTeams entry,
   * replaces "Add to team" (e.g. Depth: "Add to ST").
   */
  addButtonLabel?: string;
  /**
   * Depth Chart: list players at this position first, then everyone else.
   */
  prioritizePosition?: number;
  positionLabel?: string;
  onSort?: () => void;
  sorting?: boolean;
  gradeFilter?: GradeFilter;
  onGradeFilterChange?: (grade: GradeFilter) => void;
  gradeFilters?: { key: GradeFilter; label: string }[];
  gradeCounts?: Partial<Record<GradeFilter | SchoolYear, number>>;
};

type Props = {
  sections: SquadPlayerSection[];
  sectionsPending?: boolean;
  emptyPlayers?: boolean;
  onPressPlayer: (player: Player) => void;
  /**
   * Tablet/desktop: pitch-style formation.
   * Phone: vertical starter list with Edit / Swap actions.
   */
  formationLayout?: boolean;
  /**
   * Phone: show Edit / Swap (or Set) on starter rows instead of
   * opening the dual-pane sheet from a single tap.
   */
  starterSlotActions?: boolean;
  /** Starter / vacant slot (edit and/or swap sheet). */
  onPressStarterSlot?: (slot: StarterSlotPress) => void;
  onMoveSub?: (player: Player, direction: 'up' | 'down') => void;
  /** Rank / Add controls for the Available section. */
  availableRank?: AvailableRankHandlers;
};

/**
 * Compact pitch reading (attack at top).
 * ST CAM
 * LW CDM CM RW
 * LB CB CB RB
 * GK
 */
function slotsByLabels(labels: readonly string[]): StarterDisplaySlot[] {
  const pool = [...STARTER_DISPLAY_SLOTS];
  const next: StarterDisplaySlot[] = [];
  for (const label of labels) {
    const index = pool.findIndex((s) => s.label === label);
    if (index < 0) continue;
    next.push(pool.splice(index, 1)[0]);
  }
  return next;
}

const FORMATION_LAYOUT: readonly (readonly StarterDisplaySlot[])[] = [
  slotsByLabels(['ST', 'CAM']),
  slotsByLabels(['LW', 'CDM', 'CM', 'RW']),
  slotsByLabels(['LB', 'CB', 'CB', 'RB']),
  slotsByLabels(['GK']),
];

function squadLabel(player: Player) {
  if (!player.squad_team) return 'Available';
  if (player.squad_team === 'unavailable') return 'Unavailable';
  return SQUAD_TEAMS.find((t) => t.id === player.squad_team)?.label ?? 'Team';
}

function isStarterRole(role?: string) {
  return Boolean(role) && role !== 'Sub';
}

function rowLabel(row: SquadSectionRow) {
  return row.slotLabel ?? row.role ?? '';
}

function rowForSlot(
  rows: SquadSectionRow[],
  slot: StarterDisplaySlot
): SquadSectionRow {
  const match = rows.find(
    (r) => r.positionGroup === slot.group && r.slotIndex === slot.index
  );
  if (match) return match;
  return {
    key: `vacant-${slot.label}-${slot.group}-${slot.index}`,
    player: null,
    role: slot.label,
    slotLabel: slot.label,
    positionGroup: slot.group,
    slotIndex: slot.index,
  };
}

function formationCardStyle(countInRow: number): ViewStyle {
  if (countInRow >= 4) return styles.formationCard4;
  if (countInRow === 3) return styles.formationCard3;
  return styles.formationCard2;
}

/** Compact Available row — matches Assign Squads density. */
function AvailableRankRow({
  player,
  index,
  rank,
  pinned,
  canUp,
  canDown,
  canTop,
  canBottom,
  onTogglePin,
  onMove,
  onMoveTop,
  onMoveBottom,
  addActions,
  onPress,
}: {
  player: Player;
  index: number;
  rank: number;
  pinned: boolean;
  canUp: boolean;
  canDown: boolean;
  canTop: boolean;
  canBottom: boolean;
  onTogglePin: () => void;
  onMove: (direction: 'up' | 'down') => void;
  onMoveTop: () => void;
  onMoveBottom: () => void;
  addActions: { key: string; label: string; onPress: () => void }[];
  onPress?: () => void;
}) {
  const { roster } = useRosterData();
  const present =
    Boolean(roster?.tryout_active) && playerAttendedAnyTryout(player);
  const pos = formatPositionsShort(player.positions);
  const meta = [player.school_year, pos].filter(Boolean).join(' · ');

  return (
    <View
      style={[
        styles.availRow,
        index % 2 === 1 && !pinned && styles.availRowAlt,
        pinned && styles.availRowPinned,
        present && styles.availRowPresent,
      ]}
    >
      <View style={styles.availRankCol}>
        <Pressable
          style={[styles.availStarBtn, pinned && styles.availStarBtnOn]}
          onPress={onTogglePin}
          hitSlop={6}
          accessibilityLabel={
            pinned ? 'Unpin from top' : 'Star and lock at top'
          }
        >
          <Text
            style={[styles.availStarText, pinned && styles.availStarTextOn]}
          >
            {pinned ? '★' : '☆'}
          </Text>
        </Pressable>
        <Text
          style={[styles.availRankBadge, pinned && styles.availRankBadgePinned]}
        >
          #{rank}
        </Text>
        <View style={styles.availMoveCol}>
          <Pressable
            style={[styles.availMoveBtn, !canUp && styles.moveBtnDisabled]}
            disabled={!canUp}
            onPress={() => onMove('up')}
            hitSlop={4}
          >
            <Text style={styles.availMoveText}>↑</Text>
          </Pressable>
          <Pressable
            style={[styles.availMoveBtn, !canDown && styles.moveBtnDisabled]}
            disabled={!canDown}
            onPress={() => onMove('down')}
            hitSlop={4}
          >
            <Text style={styles.availMoveText}>↓</Text>
          </Pressable>
        </View>
        <View style={styles.availMoveCol}>
          <Pressable
            style={[styles.availMoveBtn, !canTop && styles.moveBtnDisabled]}
            disabled={!canTop}
            onPress={onMoveTop}
            hitSlop={4}
          >
            <Text style={styles.availMoveText}>⇈</Text>
          </Pressable>
          <Pressable
            style={[styles.availMoveBtn, !canBottom && styles.moveBtnDisabled]}
            disabled={!canBottom}
            onPress={onMoveBottom}
            hitSlop={4}
          >
            <Text style={styles.availMoveText}>⇊</Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        style={styles.availPlayerCell}
        onPress={onPress}
        disabled={!onPress}
      >
        <Text style={styles.availName} numberOfLines={1}>
          {player.last_name}, {player.first_name}
        </Text>
        {meta ? (
          <Text style={styles.availMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        <AvailabilityTags playerId={player.id} compact />
      </Pressable>

      {addActions.length > 0 ? (
        <View style={styles.availActions}>
          {addActions.map((action) => (
            <Pressable
              key={action.key}
              style={styles.availAddBtn}
              onPress={action.onPress}
              hitSlop={4}
            >
              <Text style={styles.availAddBtnText} numberOfLines={1}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function PlayerCard({
  row,
  onPress,
  sizeStyle,
  badge,
  canMoveUp,
  canMoveDown,
  onMove,
  onEdit,
  onSwap,
}: {
  row: SquadSectionRow;
  onPress?: () => void;
  sizeStyle?: ViewStyle;
  badge?: string;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMove?: (direction: 'up' | 'down') => void;
  onEdit?: () => void;
  onSwap?: () => void;
}) {
  const roleLabel = badge ?? (rowLabel(row) || '—');
  const showMove = Boolean(onMove);
  const showStarterActions = Boolean(onSwap || onEdit);

  if (!row.player) {
    const body = (
      <>
        <Text style={styles.role}>{rowLabel(row) || '—'}</Text>
        <Text style={styles.placeholderText}>No starter</Text>
      </>
    );
    if (showStarterActions && onSwap) {
      return (
        <View
          style={[
            styles.card,
            styles.cardWithMove,
            styles.placeholderCard,
            sizeStyle,
          ]}
        >
          <View style={styles.cardMain}>{body}</View>
          <View style={styles.actionCol}>
            <Pressable style={styles.actionBtn} onPress={onSwap} hitSlop={6}>
              <Text style={styles.actionBtnText}>Set</Text>
            </Pressable>
          </View>
        </View>
      );
    }
    if (!onPress) {
      return (
        <View style={[styles.card, styles.placeholderCard, sizeStyle]}>
          {body}
        </View>
      );
    }
    return (
      <Pressable
        style={[styles.card, styles.placeholderCard, sizeStyle]}
        onPress={onPress}
      >
        {body}
      </Pressable>
    );
  }

  const { roster } = useRosterData();
  const player = row.player;
  const starter = isStarterRole(row.role);
  const conflict = Boolean(row.conflict);
  const present =
    Boolean(roster?.tryout_active) && playerAttendedAnyTryout(player);
  const also = row.alsoLabels?.length
    ? `Also ${row.alsoLabels.join(', ')}`
    : null;
  const pos = formatPositionsShort(player.positions);

  return (
    <View
      style={[
        styles.card,
        (showMove || showStarterActions) && styles.cardWithMove,
        starter && styles.starterCard,
        present && styles.presentCard,
        conflict && styles.conflictCard,
        sizeStyle,
      ]}
    >
      <Pressable
        style={styles.cardMain}
        onPress={onPress}
        disabled={!onPress}
      >
        <View style={styles.cardTop}>
          <Text
            style={[
              styles.role,
              starter && styles.starterRole,
              conflict && styles.conflictRole,
              Boolean(badge) && styles.subBadge,
            ]}
            numberOfLines={1}
          >
            {roleLabel}
          </Text>
          {conflict && also ? (
            <Text style={styles.conflictChip} numberOfLines={1}>
              {also}
            </Text>
          ) : !sizeStyle ? (
            <Text style={styles.teamChip} numberOfLines={1}>
              {squadLabel(player)}
            </Text>
          ) : null}
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {player.last_name}, {player.first_name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[player.school_year, pos].filter(Boolean).join(' · ') || '—'}
        </Text>
        {player.squad_team == null ||
        player.squad_team === UNAVAILABLE_POOL ? (
          <AvailabilityTags playerId={player.id} compact />
        ) : null}
      </Pressable>
      {showStarterActions ? (
        <View style={styles.actionCol}>
          {onEdit ? (
            <Pressable style={styles.actionBtn} onPress={onEdit} hitSlop={6}>
              <Text style={styles.actionBtnText}>Edit</Text>
            </Pressable>
          ) : null}
          {onSwap ? (
            <Pressable
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              onPress={onSwap}
              hitSlop={6}
            >
              <Text style={[styles.actionBtnText, styles.actionBtnPrimaryText]}>
                Swap
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : showMove ? (
        <View style={styles.moveCol}>
          <Pressable
            style={[styles.moveBtn, !canMoveUp && styles.moveBtnDisabled]}
            disabled={!canMoveUp}
            onPress={() => onMove?.('up')}
            hitSlop={6}
          >
            <Text style={styles.moveBtnText}>↑</Text>
          </Pressable>
          <Pressable
            style={[styles.moveBtn, !canMoveDown && styles.moveBtnDisabled]}
            disabled={!canMoveDown}
            onPress={() => onMove?.('down')}
            hitSlop={6}
          >
            <Text style={styles.moveBtnText}>↓</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function FormationStarters({
  rows,
  squadTeam,
  onPressPlayer,
  onPressStarterSlot,
  interactive = true,
}: {
  rows: SquadSectionRow[];
  squadTeam?: SquadTeam;
  onPressPlayer: (player: Player) => void;
  onPressStarterSlot?: (slot: StarterSlotPress) => void;
  interactive?: boolean;
}) {
  function pressForRow(row: SquadSectionRow) {
    if (!interactive) return undefined;
    if (
      onPressStarterSlot &&
      squadTeam &&
      row.positionGroup != null &&
      row.slotIndex != null
    ) {
      return () =>
        onPressStarterSlot({
          squadTeam,
          positionGroup: row.positionGroup!,
          slotIndex: row.slotIndex!,
          label: rowLabel(row) || 'Slot',
          player: row.player,
        });
    }
    if (row.player) return () => onPressPlayer(row.player!);
    return undefined;
  }

  return (
    <View style={styles.formation}>
      {FORMATION_LAYOUT.map((slots, rowIndex) => {
        const cards = slots.map((slot) => rowForSlot(rows, slot));
        const sizeStyle = formationCardStyle(cards.length);
        return (
          <View key={`form-row-${rowIndex}`} style={styles.formationRow}>
            {cards.map((row) => (
              <PlayerCard
                key={row.key}
                row={row}
                onPress={pressForRow(row)}
                sizeStyle={sizeStyle}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
}

function starterPress(
  row: SquadSectionRow,
  squadTeam: SquadTeam | undefined,
  pane: 'edit' | 'swap' | 'both',
  onPressStarterSlot?: (slot: StarterSlotPress) => void
): (() => void) | undefined {
  if (
    !onPressStarterSlot ||
    !squadTeam ||
    row.positionGroup == null ||
    row.slotIndex == null
  ) {
    return undefined;
  }
  return () =>
    onPressStarterSlot({
      squadTeam,
      positionGroup: row.positionGroup!,
      slotIndex: row.slotIndex!,
      label: rowLabel(row) || 'Slot',
      player: row.player,
      pane,
    });
}

function AvailableRankBlocks({
  availableRank,
  players,
  readOnly,
  onPressPlayer,
}: {
  availableRank: AvailableRankHandlers;
  players: Player[];
  readOnly: boolean;
  onPressPlayer: (player: Player) => void;
}) {
  const orderedIds = new Set(availableRank.ordered.map((p) => p.id));
  const visible = players.filter((p) => orderedIds.has(p.id));
  // Keep Available rank order (not section row order).
  const orderedVisible = availableRank.ordered.filter((p) =>
    visible.some((v) => v.id === p.id)
  );

  const prioritize = availableRank.prioritizePosition;
  const atPos = prioritize
    ? orderedVisible.filter((p) =>
        playerInDepthGroup(p.positions, prioritize)
      )
    : orderedVisible;
  const rest = prioritize
    ? orderedVisible.filter(
        (p) => !playerInDepthGroup(p.positions, prioritize)
      )
    : [];

  const groups =
    prioritize != null
      ? [
          {
            key: 'at-pos',
            title: `Available · ${availableRank.positionLabel ?? 'Pos'}`,
            list: atPos,
            empty: `No available players at ${availableRank.positionLabel ?? 'this position'}.`,
          },
          {
            key: 'all-avail',
            title: 'All Available',
            list: rest,
            empty: 'No other available players.',
          },
        ]
      : [
          {
            key: 'available',
            title: null as string | null,
            list: orderedVisible,
            empty:
              availableRank.gradeCounts &&
              (availableRank.gradeCounts.all ?? 0) > 0 &&
              availableRank.gradeFilter &&
              availableRank.gradeFilter !== 'all'
                ? `No ${availableRank.gradeFilter} players in Available.`
                : 'No available players.',
          },
        ];

  function addActionsFor(player: Player) {
    const addTeams = availableRank.addToTeams ?? [];
    if (!availableRank.onAddToTeam || addTeams.length === 0) return [];
    return addTeams.map((team) => ({
      key: team,
      label:
        addTeams.length === 1
          ? (availableRank.addButtonLabel ?? 'Add to team')
          : SQUAD_TEAMS.find((t) => t.id === team)?.label ?? team,
      onPress: () => availableRank.onAddToTeam!(player, team),
    }));
  }

  function renderRow(player: Player, index: number) {
    const flags = availableRankMoveFlags(availableRank.ordered, player.id);
    if (!flags) return null;
    return (
      <AvailableRankRow
        key={player.id}
        player={player}
        index={index}
        rank={flags.rank}
        pinned={flags.pinned}
        canUp={flags.canUp}
        canDown={flags.canDown}
        canTop={flags.canTop}
        canBottom={flags.canBottom}
        onTogglePin={() => availableRank.onTogglePin(player)}
        onMove={(direction) => availableRank.onMove(player, direction)}
        onMoveTop={() => availableRank.onMoveTop(player)}
        onMoveBottom={() => availableRank.onMoveBottom(player)}
        addActions={addActionsFor(player)}
        onPress={!readOnly ? () => onPressPlayer(player) : undefined}
      />
    );
  }

  return (
    <View style={styles.availBlocks}>
      {groups.map((group) => (
        <View key={group.key} style={styles.availBlock}>
          {group.title ? (
            <Text style={styles.availBlockTitle}>{group.title}</Text>
          ) : null}
          <View style={styles.availList}>
            {group.list.length === 0 ? (
              <Text style={styles.availEmpty}>{group.empty}</Text>
            ) : (
              group.list.map((player, index) => renderRow(player, index))
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

export function PlayerCardList({
  sections,
  sectionsPending = false,
  emptyPlayers = false,
  onPressPlayer,
  formationLayout = false,
  starterSlotActions = false,
  onPressStarterSlot,
  onMoveSub,
  availableRank,
}: Props) {
  if (sections.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {sectionsPending
            ? 'Loading players…'
            : emptyPlayers
              ? 'No players yet. Add one or import a spreadsheet.'
              : 'No players match this filter.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.sections}>
      {sections.map((section) => {
        const starters = section.rows.filter(
          (r) => isStarterRole(r.role) && r.positionGroup != null
        );
        const subs = section.rows.filter((r) => r.role === 'Sub');
        const unlabeled = section.rows.filter(
          (r) =>
            r.role == null ||
            (r.role !== 'Sub' && r.positionGroup == null)
        );
        // Formation when this is a squad section (vacant XI slots still paint).
        const useFormation =
          formationLayout &&
          !starterSlotActions &&
          Boolean(section.squadTeam);
        const readOnly = Boolean(section.readOnly);
        const pressPlayer = readOnly ? undefined : onPressPlayer;
        const pressStarter = readOnly ? undefined : onPressStarterSlot;
        const moveSub = readOnly ? undefined : onMoveSub;
        const isAvailablePool =
          section.rankPool === 'available' && Boolean(availableRank);

        return (
          <View
            key={section.title || 'section'}
            style={[styles.section, readOnly && styles.sectionReadOnly]}
          >
            {section.title ? (
              <View style={styles.sectionTitleRow}>
                <Text
                  style={[
                    styles.sectionTitle,
                    readOnly && styles.sectionTitleReadOnly,
                  ]}
                >
                  {section.title}
                </Text>
                {readOnly ? (
                  <Text style={styles.readOnlyBadge}>Read-only</Text>
                ) : null}
              </View>
            ) : null}

            {isAvailablePool && availableRank ? (
              <View style={styles.gradeRow}>
                {(availableRank.gradeFilters ?? []).map((tab) => {
                  const active = availableRank.gradeFilter === tab.key;
                  const count =
                    tab.key === 'all'
                      ? (availableRank.gradeCounts?.all ?? 0)
                      : (availableRank.gradeCounts?.[tab.key] ?? 0);
                  return (
                    <Pressable
                      key={tab.key}
                      style={[
                        styles.gradeChip,
                        active && styles.gradeChipActive,
                      ]}
                      onPress={() =>
                        availableRank.onGradeFilterChange?.(tab.key)
                      }
                    >
                      <Text
                        style={[
                          styles.gradeText,
                          active && styles.gradeTextActive,
                        ]}
                      >
                        {tab.key === 'all'
                          ? `All ${count}`
                          : `${tab.label} ${count}`}
                      </Text>
                    </Pressable>
                  );
                })}
                {availableRank.onSort ? (
                  <Pressable
                    style={[
                      styles.sortBtn,
                      availableRank.sorting && styles.moveBtnDisabled,
                    ]}
                    disabled={availableRank.sorting}
                    onPress={availableRank.onSort}
                  >
                    <Text style={styles.sortBtnText}>
                      {availableRank.sorting ? 'Sorting…' : 'Sort'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {useFormation ? (
              <FormationStarters
                rows={starters}
                squadTeam={section.squadTeam}
                onPressPlayer={pressPlayer ?? (() => undefined)}
                onPressStarterSlot={pressStarter}
                interactive={!readOnly}
              />
            ) : isAvailablePool && availableRank ? (
              <AvailableRankBlocks
                availableRank={availableRank}
                players={unlabeled
                  .map((r) => r.player)
                  .filter((p): p is Player => Boolean(p))}
                readOnly={readOnly}
                onPressPlayer={onPressPlayer}
              />
            ) : (
              <View style={styles.list}>
                {starters.map((row) => {
                  const edit =
                    !readOnly && starterSlotActions
                      ? starterPress(
                          row,
                          section.squadTeam,
                          'edit',
                          pressStarter
                        )
                      : undefined;
                  const swap =
                    !readOnly && starterSlotActions
                      ? starterPress(
                          row,
                          section.squadTeam,
                          'swap',
                          pressStarter
                        )
                      : undefined;
                  const hasSlotActions = Boolean(edit || swap);
                  return (
                    <PlayerCard
                      key={row.key}
                      row={row}
                      onPress={
                        hasSlotActions || readOnly
                          ? undefined
                          : row.player
                            ? () => onPressPlayer(row.player!)
                            : undefined
                      }
                      onEdit={row.player ? edit : undefined}
                      onSwap={swap}
                    />
                  );
                })}
                {section.squadTeam && starters.length > 0 ? null : (
                  <>
                    {subs.map((row, index) => (
                      <PlayerCard
                        key={row.key}
                        row={row}
                        onPress={
                          !readOnly && row.player
                            ? () => onPressPlayer(row.player!)
                            : undefined
                        }
                        badge={String(index + 12)}
                        canMoveUp={!readOnly && index > 0}
                        canMoveDown={!readOnly && index < subs.length - 1}
                        onMove={
                          moveSub && row.player
                            ? (direction) => moveSub(row.player!, direction)
                            : undefined
                        }
                      />
                    ))}
                  </>
                )}
                {unlabeled.map((row) => (
                  <PlayerCard
                    key={row.key}
                    row={row}
                    onPress={
                      !readOnly && row.player
                        ? () => onPressPlayer(row.player!)
                        : undefined
                    }
                  />
                ))}
              </View>
            )}

            {(useFormation || Boolean(section.squadTeam)) && (
              <View style={styles.subsBlock}>
                <Text style={styles.subsTitle}>Subs</Text>
                {subs.length > 0 ? (
                  <View style={styles.list}>
                    {subs.map((row, index) => (
                      <PlayerCard
                        key={row.key}
                        row={row}
                        onPress={
                          !readOnly && row.player
                            ? () => onPressPlayer(row.player!)
                            : undefined
                        }
                        badge={String(index + 12)}
                        canMoveUp={!readOnly && index > 0}
                        canMoveDown={!readOnly && index < subs.length - 1}
                        onMove={
                          moveSub && row.player
                            ? (direction) => moveSub(row.player!, direction)
                            : undefined
                        }
                      />
                    ))}
                  </View>
                ) : (
                  <Text style={styles.subsEmpty}>No subs yet</Text>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sections: {
    gap: 20,
  },
  section: {
    gap: 10,
  },
  sectionReadOnly: {
    opacity: 0.72,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  sectionTitleReadOnly: {
    color: colors.muted,
  },
  readOnlyBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  gradeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  gradeChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  gradeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  gradeText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
  },
  gradeTextActive: {
    color: colors.primaryText,
  },
  sortBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
  list: {
    gap: 8,
  },
  availBlocks: {
    gap: 14,
  },
  availBlock: {
    gap: 8,
  },
  availBlockTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  availList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.radius,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  availEmpty: {
    color: colors.muted,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  availRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  availRowAlt: {
    backgroundColor: '#f7f9fb',
  },
  availRowPinned: {
    backgroundColor: colors.warningBg,
  },
  availRowPresent: {
    backgroundColor: colors.tryoutPresentBg,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  availRankCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  availStarBtn: {
    minWidth: 32,
    minHeight: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fbfcfd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  availStarBtnOn: {
    borderColor: '#e0c36a',
    backgroundColor: colors.warningBg,
  },
  availStarText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.muted,
  },
  availStarTextOn: {
    color: '#c9a227',
  },
  availRankBadge: {
    minWidth: 28,
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
  },
  availRankBadgePinned: {
    color: colors.warningText,
  },
  availMoveCol: {
    gap: 3,
  },
  availMoveBtn: {
    minWidth: 32,
    minHeight: 28,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: '#fbfcfd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  availMoveText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  availPlayerCell: {
    flex: 1,
    minWidth: 100,
    gap: 2,
  },
  availName: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  availMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  availActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-end',
    flexShrink: 0,
  },
  availAddBtn: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  availAddBtnText: {
    color: colors.primaryText,
    fontWeight: '700',
    fontSize: 12,
  },
  formation: {
    gap: 8,
    alignSelf: 'stretch',
  },
  formationRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.radius,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  cardWithMove: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  moveCol: {
    gap: 4,
  },
  actionCol: {
    gap: 6,
    alignItems: 'stretch',
  },
  actionBtn: {
    minWidth: 56,
    maxWidth: 88,
    minHeight: 34,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: '#fbfcfd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
  },
  actionBtnPrimaryText: {
    color: colors.primaryText,
  },
  moveBtn: {
    minWidth: 36,
    minHeight: 32,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: '#fbfcfd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveBtnDisabled: {
    opacity: 0.35,
  },
  moveBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  formationCard2: {
    width: '47%',
    maxWidth: 280,
    flexGrow: 0,
    flexShrink: 0,
  },
  formationCard3: {
    width: '31%',
    maxWidth: 220,
    flexGrow: 0,
    flexShrink: 0,
  },
  formationCard4: {
    width: '23.5%',
    maxWidth: 280,
    flexGrow: 0,
    flexShrink: 0,
  },
  starterCard: {
    backgroundColor: '#e8f5ef',
    borderColor: '#c5e4d4',
  },
  presentCard: {
    backgroundColor: colors.tryoutPresentBg,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  conflictCard: {
    backgroundColor: colors.warningBg,
    borderColor: '#e0c36a',
  },
  conflictRole: {
    color: colors.warningText,
  },
  conflictChip: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.warningText,
    flexShrink: 1,
  },
  placeholderCard: {
    backgroundColor: '#f3f5f7',
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  role: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
  },
  starterRole: {
    color: colors.primary,
  },
  subBadge: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'none',
  },
  teamChip: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: '600',
  },
  placeholderText: {
    fontSize: 14,
    fontStyle: 'italic',
    color: colors.muted,
    fontWeight: '600',
  },
  subsBlock: {
    gap: 8,
    marginTop: 4,
  },
  subsTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  subsEmpty: {
    fontSize: 13,
    color: colors.muted,
    fontStyle: 'italic',
  },
  empty: {
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.radius,
    backgroundColor: colors.surface,
  },
  emptyText: {
    color: colors.muted,
    textAlign: 'center',
  },
});
