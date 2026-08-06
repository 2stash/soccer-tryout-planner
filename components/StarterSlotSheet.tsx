import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Player, PlayerAssignment, PlayerInput, SquadTeam } from '@/lib/types';
import { SQUAD_TEAMS } from '@/lib/types';
import { normalizeSchoolYear } from '@/lib/schoolYear';
import {
  formatDepthGroupLabel,
  formatPositionsShort,
  getDepthStarterCount,
  normalizePositions,
  playerInDepthGroup,
  type PositionNumber,
} from '@/lib/positions';
import { comparePlayersByName } from '@/lib/playerSort';
import type { SquadPlayerSection, SquadSectionRow } from '@/lib/squadSections';
import { YearSelect } from '@/components/YearSelect';
import { PositionSelect } from '@/components/PositionSelect';
import { SquadSelect } from '@/components/SquadSelect';
import { colors, layout } from '@/constants/theme';

export type StarterSheetPane = 'edit' | 'swap' | 'both';

export type StarterSlotSelection = {
  squadTeam: SquadTeam;
  positionGroup: PositionNumber;
  slotIndex: number;
  label: string;
  player: Player | null;
  /** Phone: one pane. Tablet/desktop: both (default). */
  pane?: StarterSheetPane;
};

type Props = {
  selection: StarterSlotSelection | null;
  visible: boolean;
  /** Full roster — used to keep the edit pane fresh. */
  players: Player[];
  /** All Players sections (Varsity → JV → Fr/Soph → Available → Unavailable). */
  sections: SquadPlayerSection[];
  /**
   * Depth Chart order for this slot's position on the active squad
   * (shown first in the replace list).
   */
  depthPlayers?: Player[];
  /** Player id → labels for other positions they start at (★ on Depth Chart). */
  starterElsewhereByPlayer?: Record<string, string[]>;
  onClose: () => void;
  onSave: (id: string, input: PlayerInput) => Promise<void>;
  onAssignSquad?: (
    playerId: string,
    team: PlayerAssignment | null
  ) => Promise<void>;
  onDelete?: (player: Player) => Promise<void>;
  onSetStarter: (params: {
    playerId: string;
    /** Snapshot of the slot being replaced (sheet may close before await). */
    outgoingPlayerId: string | null;
    squadTeam: SquadTeam;
    positionNumber: PositionNumber;
    slotIndex: number;
    /** 0-based bench index when picking a sub from the active team. */
    incomingSubIndex?: number | null;
  }) => Promise<void>;
};

type CandidateRow = {
  player: Player;
  isStarter: boolean;
  /** Position abbr (ST), depth rank (#1), or sub number (12+). */
  badge: string;
  /** From depth list at this position. */
  fromDepth?: boolean;
};

type CandidateGroup = {
  key: string;
  title: string;
  rows: CandidateRow[];
};

function isStarterRow(row: SquadSectionRow) {
  return Boolean(row.role) && row.role !== 'Sub' && Boolean(row.player);
}

function isSubRow(row: SquadSectionRow) {
  return row.role === 'Sub' && Boolean(row.player);
}

/** Starters in depth-chart XI order (ST → GK). One row per player. */
function starterRowsFromSection(section: SquadPlayerSection): CandidateRow[] {
  const seen = new Set<string>();
  const next: CandidateRow[] = [];
  for (const row of section.rows) {
    if (!isStarterRow(row) || !row.player) continue;
    if (seen.has(row.player.id)) continue;
    seen.add(row.player.id);
    next.push({
      player: row.player,
      isStarter: true,
      badge: row.slotLabel ?? row.role ?? 'XI',
    });
  }
  return next;
}

/** Subs in saved bench order (#12+). */
function subRowsFromSection(section: SquadPlayerSection): CandidateRow[] {
  const subs = section.rows.filter(isSubRow);
  return subs.map((row, index) => ({
    player: row.player!,
    isStarter: false,
    badge: String(index + 12),
  }));
}

function unlabeledRowsFromSection(section: SquadPlayerSection): CandidateRow[] {
  return section.rows
    .filter((row) => row.player && row.role == null)
    .map((row) => ({
      player: row.player!,
      isStarter: false,
      badge: '—',
    }))
    .sort((a, b) => comparePlayersByName(a.player, b.player));
}

function filterOutPlayerIds(
  rows: CandidateRow[],
  exclude: Set<string>
): CandidateRow[] {
  return rows.filter((r) => !exclude.has(r.player.id));
}

/**
 * Depth list for the slot position first, then mini All Players
 * (active subs → starters → other teams → unassigned).
 */
function buildAssignGroups(
  sections: SquadPlayerSection[],
  activeTeam: SquadTeam,
  positionLabel: string,
  depthPlayers: Player[],
  depthStarterCount: number
): CandidateGroup[] {
  const next: CandidateGroup[] = [];
  const depthIds = new Set(depthPlayers.map((p) => p.id));

  if (depthPlayers.length > 0) {
    next.push({
      key: 'position-depth',
      title: `${positionLabel} depth`,
      rows: depthPlayers.map((player, index) => ({
        player,
        isStarter: index < depthStarterCount,
        badge: String(index + 1),
        fromDepth: true,
      })),
    });
  }

  const activeSection = sections.find((s) => s.squadTeam === activeTeam);
  const available = sections.find(
    (s) => !s.squadTeam && s.title === 'Available'
  );
  const unavailable = sections.find(
    (s) => !s.squadTeam && s.title === 'Unavailable'
  );

  const activeIdx = SQUAD_TEAMS.findIndex((t) => t.id === activeTeam);
  const teamOrder = [
    ...SQUAD_TEAMS.slice(activeIdx + 1),
    ...SQUAD_TEAMS.slice(0, Math.max(activeIdx, 0)),
  ];
  const otherTeams = teamOrder
    .map((team) => sections.find((s) => s.squadTeam === team.id))
    .filter((s): s is SquadPlayerSection => Boolean(s));

  if (activeSection) {
    const subs = filterOutPlayerIds(
      subRowsFromSection(activeSection),
      depthIds
    );
    if (subs.length > 0) {
      next.push({
        key: `${activeTeam}-subs`,
        title: `${activeSection.title} Subs`,
        rows: subs,
      });
    }

    const starters = filterOutPlayerIds(
      starterRowsFromSection(activeSection),
      depthIds
    );
    if (starters.length > 0) {
      next.push({
        key: `${activeTeam}-starters`,
        title: `${activeSection.title} Starters`,
        rows: starters,
      });
    }
  }

  for (const section of otherTeams) {
    const starters = filterOutPlayerIds(
      starterRowsFromSection(section),
      depthIds
    );
    if (starters.length > 0) {
      next.push({
        key: `${section.squadTeam}-starters`,
        title: `${section.title} Starters`,
        rows: starters,
      });
    }
    const subs = filterOutPlayerIds(subRowsFromSection(section), depthIds);
    if (subs.length > 0) {
      next.push({
        key: `${section.squadTeam}-subs`,
        title: `${section.title} Subs`,
        rows: subs,
      });
    }
  }

  for (const section of [available, unavailable]) {
    if (!section) continue;
    const rows = filterOutPlayerIds(
      unlabeledRowsFromSection(section),
      depthIds
    );
    if (rows.length > 0) {
      next.push({
        key: section.title.toLowerCase(),
        title: section.title,
        rows,
      });
    }
  }

  return next;
}

export function StarterSlotSheet({
  selection,
  visible,
  players,
  sections,
  depthPlayers = [],
  starterElsewhereByPlayer = {},
  onClose,
  onSave,
  onAssignSquad,
  onDelete,
  onSetStarter,
}: Props) {
  const player = useMemo(() => {
    if (!selection?.player) return null;
    return (
      players.find((p) => p.id === selection.player!.id) ?? selection.player
    );
  }, [selection, players]);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [schoolYear, setSchoolYear] = useState('');
  const [positions, setPositions] = useState<number[]>([]);
  const [squadTeam, setSquadTeam] = useState<PlayerAssignment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [swappingId, setSwappingId] = useState<string | null>(null);
  const [playerSearch, setPlayerSearch] = useState('');

  useEffect(() => {
    if (!player) {
      setFirstName('');
      setLastName('');
      setSchoolYear('');
      setPositions([]);
      setSquadTeam(null);
      setError(null);
      return;
    }
    setFirstName(player.first_name ?? '');
    setLastName(player.last_name ?? '');
    setSchoolYear(normalizeSchoolYear(player.school_year));
    setPositions(normalizePositions(player.positions));
    setSquadTeam(player.squad_team);
    setError(null);
  }, [player]);

  // Reset pick lock whenever the sheet opens/closes (prevents a stuck disabled UI).
  useEffect(() => {
    if (!visible || !selection) {
      setSwappingId(null);
      setDeleting(false);
      setError(null);
      setPlayerSearch('');
    }
  }, [visible, selection]);

  const groups = useMemo((): CandidateGroup[] => {
    if (!selection) return [];
    const label = formatDepthGroupLabel(selection.positionGroup);
    const all = buildAssignGroups(
      sections,
      selection.squadTeam,
      label,
      depthPlayers,
      getDepthStarterCount(selection.positionGroup)
    );
    const q = playerSearch.trim().toLowerCase();
    if (!q) return all;
    return all
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => {
          const first = (row.player.first_name ?? '').toLowerCase();
          const last = (row.player.last_name ?? '').toLowerCase();
          return (
            first.includes(q) ||
            last.includes(q) ||
            `${last}, ${first}`.includes(q) ||
            `${first} ${last}`.includes(q)
          );
        }),
      }))
      .filter((group) => group.rows.length > 0);
  }, [sections, selection, depthPlayers, playerSearch]);

  /** Other CB slot on this squad — can't assign the same player to both. */
  const otherCbPlayerId = useMemo(() => {
    if (!selection || selection.positionGroup !== 4) return null;
    const active = sections.find((s) => s.squadTeam === selection.squadTeam);
    if (!active) return null;
    const other = active.rows.find(
      (r) =>
        r.positionGroup === 4 &&
        r.slotIndex != null &&
        r.slotIndex !== selection.slotIndex &&
        r.player
    );
    return other?.player?.id ?? null;
  }, [sections, selection]);

  if (!selection) return null;
  const slot = selection;

  function handleSave() {
    if (!player) return;
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last name are required.');
      return;
    }
    const input = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      school_year: schoolYear.trim(),
      positions,
      position_rank: player.position_rank,
      team_rank: player.team_rank,
    };
    const teamChanged =
      Boolean(onAssignSquad) && squadTeam !== player.squad_team;
    const playerId = player.id;
    // Close first; persistence applies optimistically in the data layer.
    onClose();
    void (async () => {
      try {
        await onSave(playerId, input);
        if (teamChanged && onAssignSquad) {
          await onAssignSquad(playerId, squadTeam);
        }
      } catch (e) {
        console.warn(e instanceof Error ? e.message : 'Save failed');
      }
    })();
  }

  async function handleDelete() {
    if (!onDelete || !player) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(player);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setDeleting(false);
    }
  }

  async function handlePick(candidate: Player) {
    if (slot.player?.id === candidate.id || swappingId) return;
    if (otherCbPlayerId && candidate.id === otherCbPlayerId) return;
    setError(null);

    // Resolve bench index from the live section (depth list may hide the Subs group).
    const activeSection = sections.find((s) => s.squadTeam === slot.squadTeam);
    const activeSubs = activeSection
      ? subRowsFromSection(activeSection)
      : [];
    const incomingSubIndex = activeSubs.findIndex(
      (r) => r.player.id === candidate.id
    );

    setSwappingId(candidate.id);
    const pick = {
      playerId: candidate.id,
      outgoingPlayerId: slot.player?.id ?? null,
      squadTeam: slot.squadTeam,
      positionNumber: slot.positionGroup,
      slotIndex: slot.slotIndex,
      incomingSubIndex: incomingSubIndex >= 0 ? incomingSubIndex : null,
    };
    // Close first; optimistic update runs synchronously inside onSetStarter.
    onClose();
    try {
      await onSetStarter(pick);
    } catch (e) {
      // Sheet is closed — page-level error banner covers persistence failures.
      console.warn(
        e instanceof Error ? e.message : 'Failed to update starter'
      );
    } finally {
      setSwappingId(null);
    }
  }

  const busy = deleting || Boolean(swappingId);

  const positionLabel = formatDepthGroupLabel(slot.positionGroup);
  const pane: StarterSheetPane = slot.pane ?? 'both';
  const showEdit = pane === 'edit' || pane === 'both';
  const showSwap = pane === 'swap' || pane === 'both';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {pane === 'swap'
              ? `${player ? 'Swap' : 'Assign'} · ${slot.label}`
              : pane === 'edit'
                ? `Edit · ${slot.label}`
                : slot.label}
            {player
              ? ` · ${player.last_name}, ${player.first_name}`
              : ' · Vacant'}
          </Text>
          {player && onDelete && showEdit ? (
            <Pressable
              onPress={() => void handleDelete()}
              hitSlop={12}
              disabled={busy}
            >
              <Text style={styles.deleteHeader}>
                {deleting ? 'Deleting…' : 'Delete player'}
              </Text>
            </Pressable>
          ) : pane === 'swap' ? (
            <Pressable onPress={onClose} hitSlop={12} disabled={busy}>
              <Text style={styles.closeHeader}>Close</Text>
            </Pressable>
          ) : null}
        </View>

        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

        <View
          style={[styles.columns, !showEdit || !showSwap ? styles.columnsSingle : null]}
        >
          {showEdit ? (
          <View style={[styles.leftCol, !showSwap && styles.colSolo]}>
            <Text style={styles.colTitle}>Edit player</Text>
            {player ? (
              <>
                <ScrollView
                  style={styles.scroll}
                  contentContainerStyle={styles.editBody}
                  keyboardShouldPersistTaps="handled"
                >
                  <View style={styles.field}>
                    <Text style={styles.label}>First name</Text>
                    <TextInput
                      style={styles.input}
                      value={firstName}
                      onChangeText={setFirstName}
                      placeholder="First"
                      placeholderTextColor={colors.muted}
                    />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>Last name</Text>
                    <TextInput
                      style={styles.input}
                      value={lastName}
                      onChangeText={setLastName}
                      placeholder="Last"
                      placeholderTextColor={colors.muted}
                    />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>Year</Text>
                    <YearSelect value={schoolYear} onChange={setSchoolYear} />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>Positions</Text>
                    <PositionSelect value={positions} onChange={setPositions} />
                  </View>
                  {onAssignSquad ? (
                    <View style={styles.field}>
                      <Text style={styles.label}>Team</Text>
                      <SquadSelect
                        value={squadTeam}
                        disabled={busy}
                        onChange={setSquadTeam}
                      />
                    </View>
                  ) : null}
                </ScrollView>
                <View style={styles.editActions}>
                  <Pressable
                    style={[styles.secondaryBtn, busy && styles.disabled]}
                    disabled={busy}
                    onPress={onClose}
                  >
                    <Text style={styles.secondaryBtnText}>Close</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.primaryBtn, busy && styles.disabled]}
                    disabled={busy}
                    onPress={handleSave}
                  >
                    <Text style={styles.primaryText}>Save</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.vacantBox}>
                <Text style={styles.vacantText}>
                  {showSwap
                    ? 'No starter in this slot. Pick a player to assign them.'
                    : 'No starter in this slot. Use Swap to assign a player.'}
                </Text>
                <Pressable
                  style={[styles.secondaryBtn, styles.vacantClose]}
                  onPress={onClose}
                >
                  <Text style={styles.secondaryBtnText}>Close</Text>
                </Pressable>
              </View>
            )}
          </View>
          ) : null}

          {showSwap ? (
          <View style={[styles.rightCol, !showEdit && styles.colSolo]}>
            <Text style={styles.colTitle}>
              {player ? 'Swap into' : 'Assign to'} {slot.label}
            </Text>
            <View style={styles.searchWrap}>
              <TextInput
                style={styles.searchInput}
                value={playerSearch}
                onChangeText={setPlayerSearch}
                placeholder="Search players by name"
                placeholderTextColor={colors.muted}
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
              />
              {playerSearch.length > 0 ? (
                <Pressable
                  onPress={() => setPlayerSearch('')}
                  hitSlop={8}
                  style={styles.searchClear}
                >
                  <Text style={styles.searchClearText}>Clear</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.legendRow}>
              <View style={styles.legendSwatch} />
              <Text style={styles.legendText}>
                Marked for {positionLabel} — best fits for this slot
              </Text>
            </View>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.listBody}
              keyboardShouldPersistTaps="handled"
            >
              {groups.length === 0 ? (
                <Text style={styles.emptyList}>
                  {playerSearch.trim()
                    ? 'No players match that name.'
                    : 'No players on this roster.'}
                </Text>
              ) : (
                groups.map((group) => (
                  <View key={group.key} style={styles.group}>
                    <Text style={styles.groupTitle}>{group.title}</Text>
                    {group.rows.map((row, rowIndex) => {
                      const candidate = row.player;
                      const active = slot.player?.id === candidate.id;
                      const pending = swappingId === candidate.id;
                      const blockedOtherCb =
                        Boolean(otherCbPlayerId) &&
                        candidate.id === otherCbPlayerId;
                      // Depth list is already for this position — don't paint
                      // every row as "plays pos" (looks like all are starters).
                      const hasPos =
                        !row.fromDepth &&
                        playerInDepthGroup(
                          candidate.positions,
                          slot.positionGroup
                        );
                      const elsewhere =
                        starterElsewhereByPlayer[candidate.id] ?? [];
                      const elsewhereLabel =
                        elsewhere.length === 1
                          ? `Starter at ${elsewhere[0]}`
                          : elsewhere.length > 1
                            ? `Starter at ${elsewhere.join(', ')}`
                            : null;
                      return (
                        <Pressable
                          key={`${group.key}-${candidate.id}-${row.badge}-${rowIndex}`}
                          style={[
                            styles.candidateRow,
                            row.isStarter && styles.candidateStarter,
                            hasPos && styles.candidateHasPos,
                            active && styles.candidateActive,
                            blockedOtherCb && styles.candidateBlocked,
                          ]}
                          disabled={busy || active || blockedOtherCb}
                          onPress={() => void handlePick(candidate)}
                        >
                          <Text
                            style={[
                              styles.badge,
                              row.isStarter && styles.badgeStarter,
                              hasPos && styles.badgeHasPos,
                            ]}
                            numberOfLines={1}
                          >
                            {row.badge}
                          </Text>
                          {elsewhereLabel ? (
                            <Text
                              style={styles.elsewhereStar}
                              accessibilityLabel={elsewhereLabel}
                              // @ts-expect-error web title tooltip
                              title={elsewhereLabel}
                            >
                              ★
                            </Text>
                          ) : null}
                          <View style={styles.candidateText}>
                            <Text
                              style={[
                                styles.candidateName,
                                row.isStarter && styles.candidateNameStarter,
                                active && styles.candidateNameActive,
                              ]}
                              numberOfLines={1}
                            >
                              {candidate.last_name}, {candidate.first_name}
                            </Text>
                            <Text style={styles.candidateMeta} numberOfLines={1}>
                              {[
                                formatPositionsShort(candidate.positions) ||
                                  'No pos',
                                candidate.school_year || null,
                                elsewhere.length > 0
                                  ? `★ ${elsewhere.join(', ')}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </Text>
                          </View>
                          {pending ? (
                            <ActivityIndicator color={colors.primary} />
                          ) : active ? (
                            <Text style={styles.currentTag}>Current</Text>
                          ) : blockedOtherCb ? (
                            <Text style={styles.blockedTag}>Other CB</Text>
                          ) : row.fromDepth ? (
                            row.isStarter ? (
                              <Text style={styles.playsTag}>Starter</Text>
                            ) : (
                              <Text style={styles.pickTag}>Depth</Text>
                            )
                          ) : hasPos ? (
                            <Text style={styles.playsTag}>
                              Plays {positionLabel}
                            </Text>
                          ) : (
                            <Text style={styles.pickTag}>Add + set</Text>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                ))
              )}
            </ScrollView>
          </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.pagePaddingCompact,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  deleteHeader: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: 15,
  },
  closeHeader: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 15,
  },
  errorBanner: {
    color: colors.danger,
    paddingHorizontal: layout.pagePaddingCompact,
    paddingVertical: 8,
    fontWeight: '600',
    backgroundColor: colors.dangerBg,
  },
  columns: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
  },
  columnsSingle: {
    flexDirection: 'column',
  },
  leftCol: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    minWidth: 0,
    minHeight: 0,
  },
  rightCol: {
    flex: 1.1,
    minWidth: 0,
    minHeight: 0,
  },
  colSolo: {
    borderRightWidth: 0,
    flex: 1,
  },
  colTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  searchClear: {
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  searchClearText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 14,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
    backgroundColor: '#d8eee4',
    borderWidth: 1,
    borderColor: '#9fd0b8',
  },
  legendText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  scroll: {
    flex: 1,
  },
  editBody: {
    paddingHorizontal: 14,
    paddingBottom: 16,
    gap: 14,
  },
  editActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.muted,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: {
    color: colors.primaryText,
    fontWeight: '700',
    fontSize: 16,
  },
  secondaryBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryBtnText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 16,
  },
  vacantBox: {
    margin: 14,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 14,
  },
  vacantText: {
    color: colors.muted,
    fontWeight: '600',
    lineHeight: 21,
    fontSize: 15,
  },
  vacantClose: {
    flex: 0,
    alignSelf: 'stretch',
  },
  listBody: {
    paddingHorizontal: 12,
    paddingBottom: 40,
    gap: 14,
  },
  group: {
    gap: 6,
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 2,
  },
  emptyList: {
    color: colors.muted,
    padding: 8,
    fontWeight: '600',
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: layout.radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  candidateStarter: {
    backgroundColor: '#e8f5ef',
    borderColor: '#c5e4d4',
  },
  candidateHasPos: {
    backgroundColor: '#d8eee4',
    borderColor: '#9fd0b8',
  },
  candidateActive: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  candidateBlocked: {
    opacity: 0.45,
  },
  badge: {
    minWidth: 28,
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
  },
  elsewhereStar: {
    fontSize: 14,
    fontWeight: '800',
    color: '#c9a227',
    width: 16,
    textAlign: 'center',
  },
  badgeStarter: {
    color: colors.primary,
  },
  badgeHasPos: {
    color: colors.primary,
  },
  candidateText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  candidateName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  candidateNameStarter: {
    color: colors.text,
  },
  candidateNameActive: {
    color: colors.primary,
  },
  candidateMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  currentTag: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
  blockedTag: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.muted,
    maxWidth: 72,
    textAlign: 'right',
  },
  playsTag: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
    maxWidth: 72,
    textAlign: 'right',
  },
  pickTag: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
  },
  disabled: {
    opacity: 0.55,
  },
});
