import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import {
  PlayerTable,
  type PlayerTableSortKey,
} from '@/components/PlayerTable';
import { PlayerEditSheet } from '@/components/PlayerEditSheet';
import { useAuth } from '@/lib/AuthContext';
import { confirmAction } from '@/lib/confirm';
import {
  downloadFullPlayersCsv,
  downloadNamesYearCsv,
} from '@/lib/exportPlayers';
import {
  filterAvailableByGrade,
  type GradeFilter,
} from '@/lib/availableRank';
import { alertRequiresOnline } from '@/lib/offline/gate';
import { useOffline } from '@/lib/offline/OfflineContext';
import { useRosterData } from '@/lib/RosterDataContext';
import { useLayout } from '@/lib/layout';
import { comparePlayersByName } from '@/lib/playerSort';
import { formatPositionsShort } from '@/lib/positions';
import {
  CLASS_ORDER_DESC,
  countBySchoolYear,
  schoolYearSortKey,
} from '@/lib/schoolYear';
import type { Player, PlayerAssignment, PlayerInput } from '@/lib/types';
import { SQUAD_TEAMS, UNAVAILABLE_POOL } from '@/lib/types';
import { colors, layout } from '@/constants/theme';

function playerMetaLine(player: Player, omitYear: boolean) {
  const parts: string[] = [];
  if (!omitYear && player.school_year) parts.push(player.school_year);
  const pos = formatPositionsShort(player.positions);
  if (pos) parts.push(pos);
  if (player.squad_team === UNAVAILABLE_POOL) parts.push('Unavailable');
  else if (player.squad_team) {
    const team = SQUAD_TEAMS.find((t) => t.id === player.squad_team);
    parts.push(team?.shortLabel ?? player.squad_team);
  } else {
    parts.push('Available');
  }
  return parts.join(' · ');
}

function matchesPlayerFilter(player: Player, raw: string) {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  const posLabel = formatPositionsShort(player.positions).toLowerCase();
  const squadLabel =
    player.squad_team === 'varsity'
      ? 'varsity'
      : player.squad_team === 'jv'
        ? 'jv'
        : player.squad_team === 'fr_soph'
          ? 'fr/soph fr soph'
          : player.squad_team === UNAVAILABLE_POOL
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

function sortPlayersList(
  list: Player[],
  sortKey: PlayerTableSortKey,
  sortAsc: boolean
): Player[] {
  return [...list].sort((a, b) => {
    if (sortKey === 'school_year') {
      const cmp =
        schoolYearSortKey(a.school_year) - schoolYearSortKey(b.school_year);
      if (cmp !== 0) return sortAsc ? cmp : -cmp;
      return comparePlayersByName(a, b);
    }
    if (sortKey === 'first_name') {
      const cmp = (a.first_name ?? '').localeCompare(
        b.first_name ?? '',
        undefined,
        { sensitivity: 'base' }
      );
      if (cmp !== 0) return sortAsc ? cmp : -cmp;
      return (a.last_name ?? '').localeCompare(b.last_name ?? '', undefined, {
        sensitivity: 'base',
      });
    }
    const cmp = comparePlayersByName(a, b);
    return sortAsc ? cmp : -cmp;
  });
}

const GRADE_FILTERS: { key: GradeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...CLASS_ORDER_DESC.map((y) => ({ key: y as GradeFilter, label: y })),
];

export default function AllPlayersScreen() {
  const { session, loading: authLoading, configured } = useAuth();
  const { isPhone, isCompact } = useLayout();
  const { isOnline } = useOffline();
  const {
    rosterId,
    roster,
    players,
    loading,
    error,
    clearError,
    savePlayer,
    removePlayer,
    assignSquad,
  } = useRosterData();
  const [filter, setFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>('all');
  const [moreOpen, setMoreOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<PlayerTableSortKey>('last_name');
  const [sortAsc, setSortAsc] = useState(true);
  const [editing, setEditing] = useState<Player | null>(null);

  const classCounts = useMemo(() => countBySchoolYear(players), [players]);

  const gradeVisible = useMemo(
    () => filterAvailableByGrade(players, gradeFilter),
    [players, gradeFilter]
  );

  const cardPlayers = useMemo(() => {
    const filtered = gradeVisible.filter((p) =>
      matchesPlayerFilter(p, filter)
    );
    return sortPlayersList(filtered, sortKey, sortAsc);
  }, [gradeVisible, filter, sortKey, sortAsc]);

  const displayError = localError ?? error;

  function dismissError() {
    setLocalError(null);
    clearError();
  }

  async function handleSave(id: string, input: PlayerInput) {
    setLocalError(null);
    await savePlayer(id, input);
  }

  async function handleAssignSquad(
    playerId: string,
    team: PlayerAssignment | null
  ) {
    setLocalError(null);
    await assignSquad(playerId, team);
  }

  function handleDelete(player: Player) {
    confirmAction({
      title: 'Delete player?',
      message: `Remove ${player.last_name}, ${player.first_name} from this roster?`,
      confirmLabel: 'Delete',
      onConfirm: () => {
        void (async () => {
          setLocalError(null);
          try {
            await removePlayer(player);
            setEditing(null);
          } catch (e) {
            setLocalError(
              e instanceof Error ? e.message : 'Failed to delete player'
            );
          }
        })();
      },
    });
  }

  async function handleDeleteFromSheet(player: Player) {
    setLocalError(null);
    await removePlayer(player);
  }

  function handleSort(key: PlayerTableSortKey) {
    if (sortKey === key) {
      setSortAsc((asc) => !asc);
      return;
    }
    setSortKey(key);
    setSortAsc(true);
  }

  function handleSortByYearThenName() {
    setSortKey('school_year');
    setSortAsc(true);
  }

  if (!authLoading && (!configured || !session)) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          isCompact && styles.scrollContentCompact,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <Text style={styles.heading}>
            {roster ? `${roster.name} · All Players` : 'All Players'}
          </Text>
          <Text style={styles.sub}>
            {isPhone
              ? 'Tap a player to edit. Sort orders by class (Sr→Fr) then name.'
              : 'Edit name, year, positions, or team. Tap column headers to sort; Sort orders by class (Sr→Fr) then name.'}
          </Text>

          <View style={styles.toolbar}>
            <TextInput
              style={[styles.search, isCompact && styles.searchCompact]}
              value={filter}
              onChangeText={setFilter}
              placeholder="Filter players…"
              placeholderTextColor={colors.muted}
            />
            <Pressable
              style={[styles.primaryBtn, !isOnline && styles.btnDisabled]}
              onPress={() => {
                if (!isOnline) {
                  alertRequiresOnline('Adding players');
                  return;
                }
                router.push(`/roster/${rosterId}/add`);
              }}
            >
              <Text style={styles.primaryText}>Add</Text>
            </Pressable>
            {isCompact ? (
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => setMoreOpen((v) => !v)}
              >
                <Text style={styles.secondaryText}>More</Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  style={[styles.secondaryBtn, !isOnline && styles.btnDisabled]}
                  onPress={() => {
                    if (!isOnline) {
                      alertRequiresOnline('Import');
                      return;
                    }
                    router.push(`/roster/${rosterId}/import`);
                  }}
                >
                  <Text style={styles.secondaryText}>Import</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.secondaryBtn,
                    players.length === 0 && styles.btnDisabled,
                  ]}
                  disabled={players.length === 0}
                  onPress={() =>
                    downloadFullPlayersCsv(players, roster?.name ?? 'roster')
                  }
                >
                  <Text style={styles.secondaryText}>Export full</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.secondaryBtn,
                    players.length === 0 && styles.btnDisabled,
                  ]}
                  disabled={players.length === 0}
                  onPress={() =>
                    downloadNamesYearCsv(players, roster?.name ?? 'roster')
                  }
                >
                  <Text style={styles.secondaryText}>Export names</Text>
                </Pressable>
              </>
            )}
          </View>

          {isCompact && moreOpen ? (
            <View style={styles.morePanel}>
              <Pressable
                style={[styles.moreRow, !isOnline && styles.btnDisabled]}
                onPress={() => {
                  if (!isOnline) {
                    alertRequiresOnline('Import');
                    return;
                  }
                  setMoreOpen(false);
                  router.push(`/roster/${rosterId}/import`);
                }}
              >
                <Text style={styles.moreText}>Import</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.moreRow,
                  players.length === 0 && styles.btnDisabled,
                ]}
                disabled={players.length === 0}
                onPress={() => {
                  downloadFullPlayersCsv(players, roster?.name ?? 'roster');
                  setMoreOpen(false);
                }}
              >
                <Text style={styles.moreText}>Export full CSV</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.moreRow,
                  players.length === 0 && styles.btnDisabled,
                ]}
                disabled={players.length === 0}
                onPress={() => {
                  downloadNamesYearCsv(players, roster?.name ?? 'roster');
                  setMoreOpen(false);
                }}
              >
                <Text style={styles.moreText}>Export names CSV</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.gradeRow}>
            {GRADE_FILTERS.map((tab) => {
              const active = gradeFilter === tab.key;
              const count =
                tab.key === 'all' ? players.length : classCounts[tab.key];
              return (
                <Pressable
                  key={tab.key}
                  style={[styles.gradeChip, active && styles.gradeChipActive]}
                  onPress={() => setGradeFilter(tab.key)}
                >
                  <Text
                    style={[styles.gradeText, active && styles.gradeTextActive]}
                  >
                    {tab.key === 'all'
                      ? `All ${count}`
                      : `${tab.label} ${count}`}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              style={[
                styles.sortBtn,
                players.length === 0 && styles.btnDisabled,
              ]}
              disabled={players.length === 0}
              onPress={handleSortByYearThenName}
            >
              <Text style={styles.sortBtnText}>Sort</Text>
            </Pressable>
          </View>

          {displayError ? (
            <Pressable onPress={dismissError} style={styles.errorBanner}>
              <Text style={styles.error}>{displayError}</Text>
              <Text style={styles.errorDismiss}>Dismiss</Text>
            </Pressable>
          ) : null}

          {isPhone ? (
            <View style={styles.cardList}>
              {loading && players.length === 0 ? (
                <Text style={styles.empty}>Loading players…</Text>
              ) : cardPlayers.length === 0 ? (
                <Text style={styles.empty}>No players match.</Text>
              ) : (
                cardPlayers.map((player, index) => {
                  const meta = playerMetaLine(player, gradeFilter !== 'all');
                  return (
                    <Pressable
                      key={player.id}
                      style={[styles.card, index % 2 === 1 && styles.cardAlt]}
                      onPress={() => setEditing(player)}
                    >
                      <Text style={styles.cardName} numberOfLines={1}>
                        {player.last_name}, {player.first_name}
                      </Text>
                      {meta ? (
                        <Text style={styles.cardMeta} numberOfLines={2}>
                          {meta}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })
              )}
            </View>
          ) : (
            <PlayerTable
              players={gradeVisible}
              filter={filter}
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={handleSort}
              onSave={handleSave}
              onDelete={handleDelete}
              onAssignSquad={handleAssignSquad}
              showSquadColumn
              showRankColumns={false}
              showRoleColumn={false}
              showDelete
              sectionsPending={loading && players.length === 0}
            />
          )}

          <Text style={styles.hint}>
            {loading && players.length === 0
              ? 'Loading players…'
              : `${(isPhone ? cardPlayers : gradeVisible).length} player${
                  (isPhone ? cardPlayers : gradeVisible).length === 1 ? '' : 's'
                }${
                  gradeFilter === 'all' ? '' : ` · ${gradeFilter}`
                }${filter.trim() ? ' (filtered)' : ''}`}
          </Text>
        </View>
      </ScrollView>

      <PlayerEditSheet
        player={editing}
        visible={Boolean(editing)}
        onClose={() => setEditing(null)}
        onSave={handleSave}
        onAssignSquad={handleAssignSquad}
        onDelete={handleDeleteFromSheet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: layout.pagePadding,
    paddingTop: 12,
    paddingBottom: 48,
    alignItems: 'center',
  },
  scrollContentCompact: {
    padding: layout.pagePaddingCompact,
    paddingTop: 12,
    alignItems: 'stretch',
  },
  content: {
    width: '100%',
    maxWidth: layout.pageMaxWidth,
    gap: layout.gap,
  },
  heading: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  sub: {
    color: colors.muted,
    marginTop: -8,
    fontSize: 14,
    fontWeight: '600',
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  search: {
    flexGrow: 1,
    flexBasis: 180,
    minWidth: 140,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.radius,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
  },
  searchCompact: {
    flexBasis: 120,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: layout.radius,
  },
  primaryText: {
    color: colors.primaryText,
    fontWeight: '800',
    fontSize: 14,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: layout.radius,
  },
  secondaryText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  morePanel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.radius,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  moreRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  moreText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  gradeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  gradeChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  gradeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  gradeText: {
    fontSize: 13,
    fontWeight: '700',
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
    paddingVertical: 8,
  },
  sortBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.dangerBg,
    padding: 10,
    borderRadius: layout.radius,
  },
  error: {
    flex: 1,
    color: colors.danger,
    fontWeight: '600',
  },
  errorDismiss: {
    color: colors.danger,
    fontWeight: '800',
    fontSize: 13,
  },
  hint: {
    fontSize: 13,
    color: colors.muted,
    fontWeight: '600',
  },
  cardList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.radius,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  card: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 2,
    backgroundColor: colors.surface,
  },
  cardAlt: {
    backgroundColor: '#f7f9fb',
  },
  cardName: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 15,
  },
  cardMeta: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
});
