import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Player, PlayerAssignment, PlayerInput, SquadTeam } from '@/lib/types';
import { normalizeSchoolYear } from '@/lib/schoolYear';
import {
  formatPositionsShort,
  normalizePositions,
  positionsEqual,
} from '@/lib/positions';
import type { SquadPlayerSection } from '@/lib/squadSections';
import { YearSelect } from '@/components/YearSelect';
import { PositionSelect } from '@/components/PositionSelect';
import { SquadSelect } from '@/components/SquadSelect';
import { colors } from '@/constants/theme';

const SQUAD_COL_FLEX = 1;

type SortKey =
  | 'last_name'
  | 'first_name'
  | 'school_year'
  | 'positions'
  | 'position_rank'
  | 'team_rank';

type Props = {
  players: Player[];
  sortKey?: SortKey;
  sortAsc?: boolean;
  onSort?: (key: SortKey) => void;
  onSave: (id: string, input: PlayerInput) => Promise<void>;
  onDelete?: (player: Player) => Promise<void>;
  filter?: string;
  /** When false, hides Pos rank / Team rank columns (values preserved on save). */
  showRankColumns?: boolean;
  /** When false, hides the per-row Delete control. */
  showDelete?: boolean;
  /**
   * When provided, players are rendered in section order (team groups).
   * Row order inside each section is preserved; column sort is ignored.
   */
  sections?: SquadPlayerSection[];
  /** When true, suppress the empty state while sections are still loading. */
  sectionsPending?: boolean;
  /** Override Role column visibility (defaults to true when sections are set). */
  showRoleColumn?: boolean;
  /** When true, shows a Team column for assigning / moving squads. */
  showSquadColumn?: boolean;
  onAssignSquad?: (
    playerId: string,
    team: PlayerAssignment | null
  ) => Promise<void>;
  /** Reorder bench players (subs) within a squad. */
  onMoveSub?: (player: Player, direction: 'up' | 'down') => void | Promise<void>;
};

type Draft = {
  first_name: string;
  last_name: string;
  school_year: string;
  positions: number[];
  position_rank: string;
  team_rank: string;
};

const COLUMNS: { key: SortKey; label: string; flex: number }[] = [
  { key: 'first_name', label: 'First', flex: 1.1 },
  { key: 'last_name', label: 'Last', flex: 1.1 },
  { key: 'school_year', label: 'Year', flex: 0.65 },
  { key: 'positions', label: 'Positions', flex: 1.5 },
  { key: 'position_rank', label: 'Pos rank', flex: 0.65 },
  { key: 'team_rank', label: 'Team rank', flex: 0.65 },
];

function parseRank(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function toDraft(player: Player): Draft {
  return {
    first_name: player.first_name ?? '',
    last_name: player.last_name ?? '',
    school_year: normalizeSchoolYear(player.school_year),
    positions: normalizePositions(player.positions),
    position_rank: player.position_rank != null ? String(player.position_rank) : '',
    team_rank: player.team_rank != null ? String(player.team_rank) : '',
  };
}

function draftsEqual(a: Draft, b: Draft) {
  return (
    a.first_name === b.first_name &&
    a.last_name === b.last_name &&
    a.school_year === b.school_year &&
    positionsEqual(a.positions, b.positions) &&
    a.position_rank === b.position_rank &&
    a.team_rank === b.team_rank
  );
}

function matchesFilter(player: Player, q: string) {
  if (!q) return true;
  const posLabel = formatPositionsShort(player.positions).toLowerCase();
  const squadLabel =
    player.squad_team === 'varsity'
      ? 'varsity'
      : player.squad_team === 'jv'
        ? 'jv'
        : player.squad_team === 'fr_soph'
          ? 'fr/soph fr soph'
          : player.squad_team === 'unavailable'
            ? 'unavailable'
            : 'available unassigned';
  return (
    (player.first_name ?? '').toLowerCase().includes(q) ||
    (player.last_name ?? '').toLowerCase().includes(q) ||
    posLabel.includes(q) ||
    (player.school_year ?? '').toLowerCase().includes(q) ||
    squadLabel.includes(q)
  );
}

function sortPlayers(
  list: Player[],
  sortKey: SortKey,
  sortAsc: boolean
): Player[] {
  return [...list].sort((a, b) => {
    if (sortKey === 'positions') {
      const av = formatPositionsShort(a.positions);
      const bv = formatPositionsShort(b.positions);
      const cmp = av.localeCompare(bv, undefined, { sensitivity: 'base' });
      return sortAsc ? cmp : -cmp;
    }
    const av = a[sortKey as keyof Player];
    const bv = b[sortKey as keyof Player];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') {
      return sortAsc ? av - bv : bv - av;
    }
    const cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
    return sortAsc ? cmp : -cmp;
  });
}

export function PlayerTable({
  players,
  sortKey = 'last_name',
  sortAsc = true,
  onSort,
  onSave,
  onDelete,
  filter = '',
  showRankColumns = true,
  showDelete,
  sections,
  sectionsPending = false,
  showRoleColumn,
  showSquadColumn = false,
  onAssignSquad,
  onMoveSub,
}: Props) {
  const allowDelete = showDelete ?? Boolean(onDelete);
  const q = filter.trim().toLowerCase();
  const columns = showRankColumns
    ? COLUMNS
    : COLUMNS.filter((col) => col.key !== 'position_rank' && col.key !== 'team_rank');
  const showRole = showRoleColumn ?? Boolean(sections);
  const showSquad = showSquadColumn && Boolean(onAssignSquad);
  const showSubMove = Boolean(onMoveSub);

  const filteredSections = sections
    ?.map((section) => ({
      ...section,
      rows: section.rows.filter((row) => {
        if (!row.player) return !q;
        return matchesFilter(row.player, q);
      }),
    }))
    // Keep named squad sections even when empty (e.g. master All → 3 teams).
    .filter(
      (section) => section.rows.length > 0 || Boolean(section.squadTeam)
    );

  const flatSorted = sortPlayers(
    players.filter((p) => matchesFilter(p, q)),
    sortKey,
    sortAsc
  );

  if (sectionsPending && (!filteredSections || filteredSections.length === 0)) {
    return null;
  }

  const hasRows = filteredSections
    ? filteredSections.length > 0
    : flatSorted.length > 0;

  if (!hasRows) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {players.length === 0
            ? 'No players yet. Add one or import a spreadsheet.'
            : 'No players match this filter.'}
        </Text>
      </View>
    );
  }

  function renderHeader() {
    return (
      <View style={[styles.row, styles.headerRow]}>
        {showSubMove ? <View style={styles.orderCol} /> : null}
        {showRole ? <Text style={[styles.headerText, styles.roleCol]}>Role</Text> : null}
        {columns.map((col) => (
          <Pressable
            key={col.key}
            style={[styles.cell, { flex: col.flex }]}
            onPress={() => onSort?.(col.key)}
            disabled={!onSort || Boolean(sections)}
          >
            <Text style={styles.headerText}>
              {col.label}
              {!sections && onSort && sortKey === col.key ? (sortAsc ? ' ↑' : ' ↓') : ''}
            </Text>
          </Pressable>
        ))}
        {showSquad ? (
          <Text style={[styles.headerText, styles.cell, { flex: SQUAD_COL_FLEX }]}>
            Team
          </Text>
        ) : null}
        {allowDelete ? (
          <View style={styles.actionsCol}>
            <Text style={styles.headerText}> </Text>
          </View>
        ) : null}
      </View>
    );
  }

  if (filteredSections) {
    return (
      <View style={styles.sections}>
        {filteredSections.map((section) => (
          <View key={section.title || 'section'} style={styles.sectionBlock}>
            {section.title ? (
              <Text
                style={[
                  styles.sectionTitle,
                  section.readOnly && styles.sectionTitleReadOnly,
                ]}
              >
                {section.title}
                {section.readOnly ? ' · read-only' : ''}
              </Text>
            ) : null}
            {section.rows.length === 0 ? (
              <Text style={styles.sectionEmpty}>No players at this position.</Text>
            ) : (
              <View style={styles.table}>
                {renderHeader()}
                {(() => {
                  const subRows = section.rows.filter(
                    (r) => r.role === 'Sub' && r.player
                  );
                  return section.rows.map((row) => {
                    if (!row.player) {
                      return (
                        <PlaceholderRow
                          key={row.key}
                          role={row.role}
                          slotLabel={row.slotLabel}
                          showRoleColumn={showRole}
                          showSquadColumn={showSquad}
                          showSubMove={showSubMove}
                          columnFlexes={columns.map((c) => c.flex)}
                          showDelete={allowDelete}
                        />
                      );
                    }
                    const subIndex =
                      row.role === 'Sub'
                        ? subRows.findIndex((r) => r.key === row.key)
                        : -1;
                    return (
                      <EditableRow
                        key={row.key}
                        player={row.player}
                        role={row.role}
                        showRoleColumn={showRole}
                        showSquadColumn={showSquad}
                        onAssignSquad={
                          section.readOnly ? undefined : onAssignSquad
                        }
                        onSave={onSave}
                        onDelete={section.readOnly ? undefined : onDelete}
                        showRankColumns={showRankColumns}
                        showDelete={allowDelete && !section.readOnly}
                        canMoveUp={subIndex > 0}
                        canMoveDown={
                          subIndex >= 0 && subIndex < subRows.length - 1
                        }
                        onMoveSub={
                          !section.readOnly && subIndex >= 0 && onMoveSub
                            ? (direction) =>
                                onMoveSub(row.player!, direction)
                            : undefined
                        }
                      />
                    );
                  });
                })()}
              </View>
            )}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.table}>
      {renderHeader()}
      {flatSorted.map((player) => (
        <EditableRow
          key={player.id}
          player={player}
          showSquadColumn={showSquad}
          onAssignSquad={onAssignSquad}
          onSave={onSave}
          onDelete={onDelete}
          showRankColumns={showRankColumns}
          showDelete={allowDelete}
        />
      ))}
    </View>
  );
}

function isStarterRole(role?: string) {
  return Boolean(role) && role !== 'Sub';
}

function PlaceholderRow({
  role,
  slotLabel,
  showRoleColumn,
  showSquadColumn,
  showSubMove,
  columnFlexes,
  showDelete,
}: {
  role?: string;
  slotLabel?: string;
  showRoleColumn: boolean;
  showSquadColumn: boolean;
  showSubMove?: boolean;
  columnFlexes: number[];
  showDelete: boolean;
}) {
  const label = showRoleColumn
    ? 'No starter'
    : slotLabel
      ? `No starter · ${slotLabel}`
      : 'No starter';
  return (
    <View style={[styles.row, styles.placeholderRow]}>
      {showSubMove ? <View style={styles.orderCol} /> : null}
      {showRoleColumn ? (
        <Text style={[styles.roleText, styles.roleCol, styles.placeholderRole]}>
          {role ?? slotLabel ?? '—'}
        </Text>
      ) : null}
      <Text style={[styles.placeholderText, { flex: columnFlexes[0] ?? 1 }]}>
        {label}
      </Text>
      {columnFlexes.slice(1).map((flex, index) => (
        <Text key={index} style={[styles.placeholderDash, { flex }]}>
          —
        </Text>
      ))}
      {showSquadColumn ? (
        <Text style={[styles.placeholderDash, { flex: SQUAD_COL_FLEX }]}>—</Text>
      ) : null}
      {showDelete ? <View style={styles.actionsCol} /> : null}
    </View>
  );
}

function EditableRow({
  player,
  role,
  showRoleColumn = false,
  showSquadColumn = false,
  onAssignSquad,
  onSave,
  onDelete,
  showRankColumns,
  showDelete,
  canMoveUp = false,
  canMoveDown = false,
  onMoveSub,
}: {
  player: Player;
  role?: string;
  showRoleColumn?: boolean;
  showSquadColumn?: boolean;
  onAssignSquad?: (
    playerId: string,
    team: PlayerAssignment | null
  ) => Promise<void>;
  onSave: (id: string, input: PlayerInput) => Promise<void>;
  onDelete?: (player: Player) => Promise<void>;
  showRankColumns: boolean;
  showDelete: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveSub?: (direction: 'up' | 'down') => void | Promise<void>;
}) {
  const isStarter = isStarterRole(role);
  const [draft, setDraft] = useState(() => toDraft(player));
  const baselineRef = useRef(toDraft(player));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    const next = toDraft(player);
    setDraft((current) => {
      if (draftsEqual(current, baselineRef.current) || draftsEqual(current, next)) {
        baselineRef.current = next;
        return next;
      }
      return current;
    });
  }, [player.id, player.updated_at]);

  function updateField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function commit(nextDraft = draft) {
    if (draftsEqual(nextDraft, baselineRef.current)) return;

    if (!nextDraft.first_name.trim() || !nextDraft.last_name.trim()) {
      setError('First and last name required');
      return;
    }
    if (nextDraft.position_rank.trim() && parseRank(nextDraft.position_rank) === null) {
      setError('Pos rank must be a number');
      return;
    }
    if (nextDraft.team_rank.trim() && parseRank(nextDraft.team_rank) === null) {
      setError('Team rank must be a number');
      return;
    }

    const input: PlayerInput = {
      first_name: nextDraft.first_name.trim(),
      last_name: nextDraft.last_name.trim(),
      school_year: nextDraft.school_year.trim(),
      positions: nextDraft.positions,
      position_rank: showRankColumns
        ? parseRank(nextDraft.position_rank)
        : player.position_rank,
      team_rank: showRankColumns ? parseRank(nextDraft.team_rank) : player.team_rank,
    };

    setSaving(true);
    setError(null);
    try {
      await onSave(player.id, input);
      const saved: Draft = {
        first_name: input.first_name,
        last_name: input.last_name,
        school_year: input.school_year,
        positions: input.positions,
        position_rank: input.position_rank != null ? String(input.position_rank) : '',
        team_rank: input.team_rank != null ? String(input.team_rank) : '',
      };
      baselineRef.current = saved;
      setDraft(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(player);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setDeleting(false);
    }
  }

  async function handleAssignSquad(team: PlayerAssignment | null) {
    if (!onAssignSquad || team === player.squad_team) return;
    setAssigning(true);
    setError(null);
    try {
      await onAssignSquad(player.id, team);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update team');
    } finally {
      setAssigning(false);
    }
  }

  async function handleMove(direction: 'up' | 'down') {
    if (!onMoveSub) return;
    setMoving(true);
    setError(null);
    try {
      await onMoveSub(direction);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reorder');
    } finally {
      setMoving(false);
    }
  }

  return (
    <View>
      <View
        style={[
          styles.row,
          isStarter && styles.starterRow,
          (saving || deleting || assigning || moving) && styles.rowBusy,
        ]}
      >
        {onMoveSub ? (
          <View style={styles.orderCol}>
            <Pressable
              style={[styles.moveBtn, (!canMoveUp || moving) && styles.disabled]}
              disabled={!canMoveUp || moving}
              onPress={() => void handleMove('up')}
            >
              <Text style={styles.moveBtnText}>↑</Text>
            </Pressable>
            <Pressable
              style={[styles.moveBtn, (!canMoveDown || moving) && styles.disabled]}
              disabled={!canMoveDown || moving}
              onPress={() => void handleMove('down')}
            >
              <Text style={styles.moveBtnText}>↓</Text>
            </Pressable>
          </View>
        ) : null}
        {showRoleColumn ? (
          <Text style={[styles.roleText, styles.roleCol, isStarter && styles.starterText]}>
            {role ?? '—'}
          </Text>
        ) : null}
        <TextInput
          style={[styles.input, { flex: 1.1 }]}
          value={draft.first_name}
          onChangeText={(v) => updateField('first_name', v)}
          onBlur={() => void commit()}
          placeholder="First"
          placeholderTextColor={colors.muted}
        />
        <TextInput
          style={[styles.input, { flex: 1.1 }]}
          value={draft.last_name}
          onChangeText={(v) => updateField('last_name', v)}
          onBlur={() => void commit()}
          placeholder="Last"
          placeholderTextColor={colors.muted}
        />
        <YearSelect
          style={{ flex: 0.65 }}
          value={draft.school_year}
          onChange={(year) => {
            const next = { ...draft, school_year: year };
            setDraft(next);
            void commit(next);
          }}
        />
        <PositionSelect
          style={{ flex: 1.5 }}
          compact
          value={draft.positions}
          onChange={(positions) => {
            const next = { ...draft, positions };
            setDraft(next);
            void commit(next);
          }}
        />
        {showRankColumns ? (
          <>
            <TextInput
              style={[styles.input, { flex: 0.65 }]}
              value={draft.position_rank}
              onChangeText={(v) => updateField('position_rank', v)}
              onBlur={() => void commit()}
              keyboardType="numeric"
              placeholder="#"
              placeholderTextColor={colors.muted}
            />
            <TextInput
              style={[styles.input, { flex: 0.65 }]}
              value={draft.team_rank}
              onChangeText={(v) => updateField('team_rank', v)}
              onBlur={() => void commit()}
              keyboardType="numeric"
              placeholder="#"
              placeholderTextColor={colors.muted}
            />
          </>
        ) : null}
        {showSquadColumn && onAssignSquad ? (
          <SquadSelect
            style={{ flex: SQUAD_COL_FLEX }}
            value={player.squad_team}
            disabled={assigning || saving || deleting}
            onChange={(team) => void handleAssignSquad(team)}
          />
        ) : null}
        {showDelete ? (
          <View style={styles.actionsCol}>
            <Pressable
              style={[styles.deleteBtn, deleting && styles.disabled]}
              onPress={() => void handleDelete()}
              disabled={deleting || saving || assigning}
            >
              <Text style={styles.deleteText}>{deleting ? '…' : 'Delete'}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      {error ? <Text style={styles.rowError}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sections: {
    gap: 20,
  },
  sectionBlock: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  sectionTitleReadOnly: {
    color: colors.muted,
  },
  sectionEmpty: {
    color: colors.muted,
    fontSize: 13,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 4,
  },
  starterRow: {
    backgroundColor: '#e8f5ef',
  },
  placeholderRow: {
    backgroundColor: '#f3f5f7',
  },
  placeholderText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    fontStyle: 'italic',
    paddingHorizontal: 6,
  },
  placeholderDash: {
    fontSize: 13,
    color: colors.muted,
    paddingHorizontal: 6,
  },
  placeholderRole: {
    color: colors.muted,
    fontStyle: 'italic',
  },
  rowBusy: {
    opacity: 0.7,
  },
  headerRow: {
    backgroundColor: '#e8eef3',
    paddingVertical: 10,
  },
  cell: {
    paddingHorizontal: 6,
  },
  headerText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
  },
  roleCol: {
    width: 64,
  },
  orderCol: {
    width: 36,
    gap: 2,
    alignItems: 'center',
  },
  moveBtn: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  moveBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    paddingHorizontal: 4,
  },
  starterText: {
    color: colors.primary,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.text,
    backgroundColor: '#fbfcfd',
    minWidth: 0,
  },
  actionsCol: {
    width: 72,
    alignItems: 'flex-end',
    paddingHorizontal: 4,
  },
  deleteBtn: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  deleteText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
  rowError: {
    color: colors.danger,
    fontSize: 12,
    paddingHorizontal: 12,
    paddingBottom: 6,
    backgroundColor: colors.dangerBg,
  },
  empty: {
    padding: 24,
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
