import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { playersInRankPool } from '@/lib/assignPools';
import { alertRequiresOnline } from '@/lib/offline/gate';
import { useOffline } from '@/lib/offline/OfflineContext';
import {
  filterAvailableByGrade,
  orderAvailablePlayers,
  type GradeFilter,
} from '@/lib/availableRank';
import { confirmAction } from '@/lib/confirm';
import { useRosterData } from '@/lib/RosterDataContext';
import { useLayout } from '@/lib/layout';
import {
  CLASS_ORDER_DESC,
  countBySchoolYear,
} from '@/lib/schoolYear';
import {
  buildViewsFromCache,
  getSquadDepthViewFromCache,
  type SquadPlayerSection,
} from '@/lib/squadSections';
import type {
  Player,
  PlayerAssignment,
  PlayerInput,
  SquadTeam,
} from '@/lib/types';
import { isSquadTeam, SQUAD_TEAMS } from '@/lib/types';
import {
  downloadFullPlayersCsv,
  downloadNamesYearCsv,
} from '@/lib/exportPlayers';
import {
  formatDepthGroupLabel,
  formatPositionsShort,
  getDepthPositionGroup,
} from '@/lib/positions';
import { PlayerCardList } from '@/components/PlayerCardList';
import { PlayerEditSheet } from '@/components/PlayerEditSheet';
import {
  StarterSlotSheet,
  type StarterSlotSelection,
} from '@/components/StarterSlotSheet';
import { colors, layout } from '@/constants/theme';

const GRADE_FILTERS: { key: GradeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...CLASS_ORDER_DESC.map((y) => ({ key: y as GradeFilter, label: y })),
];

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

function filterSections(
  sections: SquadPlayerSection[],
  filter: string
): SquadPlayerSection[] {
  const q = filter.trim().toLowerCase();
  return sections
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => {
        if (!row.player) return !q;
        return matchesFilter(row.player, q);
      }),
    }))
    .filter(
      (section) =>
        section.rows.length > 0 || section.rankPool === 'available'
    );
}

export default function RosterPlayersScreen() {
  const { q } = useLocalSearchParams<{ id: string; q?: string }>();
  const { session, loading: authLoading, configured } = useAuth();
  const { isPhone, isCompact } = useLayout();
  const { isOnline } = useOffline();
  const {
    rosterId,
    roster,
    players,
    depthCache,
    loading,
    depthReady,
    error,
    savePlayer,
    removePlayer,
    assignSquad,
    moveSub,
    setStarter,
    clearError,
    ensureAvailableRanks,
    moveAvailable,
    toggleAvailablePin,
    moveAvailableToTop,
    moveAvailableToBottom,
    resetAvailableOrder,
  } = useRosterData();
  const [filter, setFilter] = useState(() => (typeof q === 'string' ? q : ''));
  const [editing, setEditing] = useState<Player | null>(null);
  const [starterSlot, setStarterSlot] = useState<StarterSlotSelection | null>(
    null
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const [sortingAvailable, setSortingAvailable] = useState(false);
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>('all');

  const addToTeams = useMemo(
    (): SquadTeam[] => SQUAD_TEAMS.map((t) => t.id),
    []
  );
  const availableOrdered = useMemo(
    () => orderAvailablePlayers(playersInRankPool(players, 'available')),
    [players]
  );
  const availableVisible = useMemo(
    () => filterAvailableByGrade(availableOrdered, gradeFilter),
    [availableOrdered, gradeFilter]
  );
  const availableClassCounts = useMemo(
    () => countBySchoolYear(availableOrdered),
    [availableOrdered]
  );

  useEffect(() => {
    if (typeof q === 'string') setFilter(q);
  }, [q]);

  useEffect(() => {
    if (loading || availableOrdered.length === 0) return;
    void ensureAvailableRanks().catch((e) => {
      console.warn(
        e instanceof Error ? e.message : 'Failed to sync available ranks'
      );
    });
  }, [loading, availableOrdered.length, ensureAvailableRanks]);

  const sections = useMemo(() => {
    // Always paint squad shells (vacant XI + empty Subs) — never collapse to a spinner.
    return buildViewsFromCache(
      players,
      depthCache,
      undefined,
      SQUAD_TEAMS.map((t) => t.id)
    ).squadSections;
  }, [players, depthCache]);

  const filteredSections = useMemo(() => {
    const withGrade = sections.map((section) => {
      if (section.rankPool !== 'available' || gradeFilter === 'all') {
        return section;
      }
      const visibleIds = new Set(availableVisible.map((p) => p.id));
      return {
        ...section,
        rows: section.rows.filter(
          (row) => row.player && visibleIds.has(row.player.id)
        ),
      };
    });
    return filterSections(withGrade, filter);
  }, [sections, filter, gradeFilter, availableVisible]);

  const starterSheetDepth = useMemo(() => {
    if (!starterSlot || !depthReady) {
      return {
        depthPlayers: [] as Player[],
        starterElsewhereByPlayer: {} as Record<string, string[]>,
      };
    }
    const squadPlayers = players.filter(
      (p) => p.squad_team === starterSlot.squadTeam
    );
    const view = getSquadDepthViewFromCache({
      squadPlayers,
      cache: depthCache[starterSlot.squadTeam],
      positionNumber: starterSlot.positionGroup,
    });
    const currentGroup = getDepthPositionGroup(starterSlot.positionGroup);
    const starterElsewhereByPlayer: Record<string, string[]> = {};
    for (const [playerId, positions] of Object.entries(
      view.starterPositionsByPlayer
    )) {
      const labels = positions
        .filter((n) => !currentGroup.includes(n))
        .map((n) => formatDepthGroupLabel(n));
      if (labels.length > 0) starterElsewhereByPlayer[playerId] = labels;
    }
    return {
      depthPlayers: view.orderedAtPosition,
      starterElsewhereByPlayer,
    };
  }, [starterSlot, depthReady, players, depthCache]);
  if (!authLoading && (!configured || !session)) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  async function handleSave(playerId: string, input: PlayerInput) {
    await savePlayer(playerId, input);
  }

  async function handleDelete(player: Player) {
    await removePlayer(player);
  }

  async function handleAssignSquad(
    playerId: string,
    team: PlayerAssignment | null
  ) {
    await assignSquad(playerId, team);
  }

  async function handleMoveSub(player: Player, direction: 'up' | 'down') {
    if (!isSquadTeam(player.squad_team)) return;
    await moveSub({
      squadTeam: player.squad_team,
      playerId: player.id,
      direction,
    });
  }

  async function handleMoveAvailable(
    player: Player,
    direction: 'up' | 'down'
  ) {
    await moveAvailable({
      playerId: player.id,
      direction,
      grade: gradeFilter,
      pool: 'available',
    });
  }

  async function handleToggleAvailablePin(player: Player) {
    await toggleAvailablePin({
      playerId: player.id,
      grade: gradeFilter,
      pool: 'available',
    });
  }

  async function handleMoveAvailableTop(player: Player) {
    await moveAvailableToTop({
      playerId: player.id,
      grade: gradeFilter,
      pool: 'available',
    });
  }

  async function handleMoveAvailableBottom(player: Player) {
    await moveAvailableToBottom({
      playerId: player.id,
      grade: gradeFilter,
      pool: 'available',
    });
  }

  async function handleAddToTeam(player: Player, team: SquadTeam) {
    await assignSquad(player.id, team);
  }

  function confirmSortAvailable() {
    if (availableOrdered.length === 0 || sortingAvailable) return;
    confirmAction({
      title: 'Reset Available order?',
      message:
        'This sorts unstarred players by class (Sr→Fr) then name. Starred players stay at the top in their current order. Your custom ranking of unstarred players will be lost.',
      confirmLabel: 'Sort',
      onConfirm: () => {
        void (async () => {
          setSortingAvailable(true);
          try {
            await resetAvailableOrder('available');
          } catch (e) {
            console.warn(
              e instanceof Error ? e.message : 'Failed to sort Available'
            );
          } finally {
            setSortingAvailable(false);
          }
        })();
      },
    });
  }

  async function handleSetStarter(params: {
    playerId: string;
    outgoingPlayerId: string | null;
    squadTeam: SquadTeam;
    positionNumber: number;
    slotIndex: number;
    incomingSubIndex?: number | null;
  }) {
    await setStarter({
      squadTeam: params.squadTeam,
      positionNumber: params.positionNumber,
      slotIndex: params.slotIndex,
      playerId: params.playerId,
      outgoingPlayerId: params.outgoingPlayerId,
      incomingSubIndex: params.incomingSubIndex ?? null,
    });
  }

  const pageSub = isPhone
    ? 'Edit or Swap on a starter. Rank Available with ★ / ↑↓. Add to team from Available cards.'
    : 'Tap a starter to edit or swap. Rank Available like Assign Squads, then Add to team.';

  const hintExtra = isPhone
    ? ' · Available: ★ ↑↓ Add to team · Edit / Swap on starters'
    : ' · Available: star, reorder, Add to team · dual-starter highlight = resolve on Depth';

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
          <Text style={styles.pageTitle}>
            {roster ? `${roster.name} · Assign Positions` : 'Assign Positions'}
          </Text>
          <Text style={styles.pageSub}>{pageSub}</Text>

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
                <Text style={styles.moreText}>Import spreadsheet</Text>
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

          {error ? (
            <Pressable onPress={clearError} style={styles.errorBanner}>
              <Text style={styles.error}>{error}</Text>
              <Text style={styles.errorDismiss}>Dismiss</Text>
            </Pressable>
          ) : null}

          {(
            <PlayerCardList
              sections={filteredSections}
              sectionsPending={loading || (!depthReady && players.length > 0)}
              emptyPlayers={!loading && players.length === 0}
              formationLayout={!isPhone}
              starterSlotActions={isPhone}
              onPressPlayer={setEditing}
              onPressStarterSlot={setStarterSlot}
              onMoveSub={handleMoveSub}
              availableRank={{
                ordered: availableVisible,
                onMove: (player, direction) => {
                  void handleMoveAvailable(player, direction);
                },
                onMoveTop: (player) => {
                  void handleMoveAvailableTop(player);
                },
                onMoveBottom: (player) => {
                  void handleMoveAvailableBottom(player);
                },
                onTogglePin: (player) => {
                  void handleToggleAvailablePin(player);
                },
                onAddToTeam: (player, team) => {
                  void handleAddToTeam(player, team);
                },
                addToTeams,
                onSort: confirmSortAvailable,
                sorting: sortingAvailable,
                gradeFilter,
                onGradeFilterChange: setGradeFilter,
                gradeFilters: GRADE_FILTERS,
                gradeCounts: {
                  all: availableOrdered.length,
                  ...availableClassCounts,
                },
              }}
            />
          )}

          <Text style={styles.hint}>
            {loading && players.length === 0
              ? 'Loading players…'
              : `${players.length} player${players.length === 1 ? '' : 's'}${hintExtra}`}
          </Text>
        </View>
      </ScrollView>

      <PlayerEditSheet
        player={editing}
        visible={Boolean(editing)}
        onClose={() => setEditing(null)}
        onSave={handleSave}
        onAssignSquad={handleAssignSquad}
        onDelete={handleDelete}
      />

      <StarterSlotSheet
        selection={starterSlot}
        visible={Boolean(starterSlot)}
        players={players}
        sections={sections}
        depthPlayers={starterSheetDepth.depthPlayers}
        starterElsewhereByPlayer={starterSheetDepth.starterElsewhereByPlayer}
        onClose={() => setStarterSlot(null)}
        onSave={handleSave}
        onAssignSquad={handleAssignSquad}
        onDelete={handleDelete}
        onSetStarter={handleSetStarter}
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
  pageTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  pageSub: {
    fontSize: 14,
    color: colors.muted,
    fontWeight: '600',
    marginTop: -4,
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
});
