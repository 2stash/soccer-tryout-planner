import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect } from 'expo-router';
import { PlayerTable } from '@/components/PlayerTable';
import { PlayerCardList } from '@/components/PlayerCardList';
import { PlayerEditSheet } from '@/components/PlayerEditSheet';
import { DepthPositionList } from '@/components/DepthPositionList';
import { FormationPitchPicker } from '@/components/FormationPitchPicker';
import { useAuth } from '@/lib/AuthContext';
import { playersInRankPool } from '@/lib/assignPools';
import {
  filterAvailableByGrade,
  orderAvailablePlayers,
  type GradeFilter,
} from '@/lib/availableRank';
import { confirmAction } from '@/lib/confirm';
import { useRosterData } from '@/lib/RosterDataContext';
import { useLayout } from '@/lib/layout';
import { comparePlayersByName } from '@/lib/playerSort';
import {
  formatDepthGroupLabel,
  getDepthCanonicalPosition,
  getDepthPositionGroup,
  getDepthStarterCount,
  normalizePositions,
  playerInDepthGroup,
} from '@/lib/positions';
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
import { SQUAD_TEAMS } from '@/lib/types';
import { colors, layout } from '@/constants/theme';

const GRADE_FILTERS: { key: GradeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...CLASS_ORDER_DESC.map((y) => ({ key: y as GradeFilter, label: y })),
];

type SquadFilter = 'all' | SquadTeam;

function isSquadTeamFilter(key: SquadFilter): key is SquadTeam {
  return key === 'varsity' || key === 'jv' || key === 'fr_soph';
}

/** Formation + depth + XI need this much width; below that, drop to 2-col. */
const DEPTH_THREE_COL_MIN = 1280;

export default function DepthChartScreen() {
  const { session, loading: authLoading, configured } = useAuth();
  const { width, isPhone, isTablet, isDesktop } = useLayout();
  const {
    players,
    depthCache,
    loading,
    depthReady,
    error,
    clearError,
    savePlayer,
    removePlayer,
    assignSquad,
    changePositions,
    moveDepth,
    moveSub,
    ensureAvailableRanks,
    moveAvailable,
    toggleAvailablePin,
    moveAvailableToTop,
    moveAvailableToBottom,
    resetAvailableOrder,
  } = useRosterData();

  const [gradeFilter, setGradeFilter] = useState<GradeFilter>('all');
  const [sortingAvailable, setSortingAvailable] = useState(false);

  const filters = useMemo(
    (): { key: SquadFilter; label: string }[] => [
      { key: 'all', label: 'All players' },
      ...SQUAD_TEAMS.map((t) => ({ key: t.id as SquadFilter, label: t.label })),
    ],
    []
  );

  const [filter, setFilter] = useState<SquadFilter>('all');
  useEffect(() => {
    if (!filters.some((f) => f.key === filter)) {
      setFilter(filters[0]?.key ?? 'all');
    }
  }, [filters, filter]);

  const [selectedPosition, setSelectedPosition] = useState(9);
  const [formationOpen, setFormationOpen] = useState(false);
  const [editing, setEditing] = useState<Player | null>(null);
  /** Phone: cards + sheet. iPad/desktop: inline pos/team table (intentional). */
  const compactLists = isPhone;
  const editingPlayer = useMemo(() => {
    if (!editing) return null;
    return players.find((p) => p.id === editing.id) ?? editing;
  }, [editing, players]);

  const canReorder = filter !== 'all';
  const viewingSquadDepth = canReorder;
  const squadDepthReady = depthReady;
  const starterCount = getDepthStarterCount(selectedPosition);
  const filterLabel =
    filters.find((item) => item.key === filter)?.label ?? 'All players';
  const positionLabel = formatDepthGroupLabel(selectedPosition);
  /** Wide desktop only — otherwise middle/right collide and we use 2-col. */
  const useThreeCol = isDesktop && width >= DEPTH_THREE_COL_MIN;
  const useTwoCol = isTablet || (isDesktop && !useThreeCol);
  /** Third XI column for a single-squad depth view. */
  const showSideXi = useThreeCol && viewingSquadDepth;

  const filteredPlayers = useMemo(() => {
    if (filter === 'all') return players;
    return players.filter((p) => p.squad_team === filter);
  }, [players, filter]);

  const squadOnlyPlayers = useMemo(() => {
    if (isSquadTeamFilter(filter)) {
      return filteredPlayers.filter((p) => p.squad_team === filter);
    }
    return filteredPlayers;
  }, [filteredPlayers, filter]);

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
  const availableSection = useMemo(
    (): SquadPlayerSection[] => [
      {
        title: '',
        rankPool: 'available',
        rows: availableVisible.map((p) => ({ key: p.id, player: p })),
      },
    ],
    [availableVisible]
  );

  const addToTeamsForAvailable = useMemo(
    (): SquadTeam[] => SQUAD_TEAMS.map((t) => t.id),
    []
  );

  useEffect(() => {
    if (loading || availableOrdered.length === 0) return;
    void ensureAvailableRanks().catch((e) => {
      console.warn(
        e instanceof Error ? e.message : 'Failed to sync available ranks'
      );
    });
  }, [loading, availableOrdered.length, ensureAvailableRanks]);

  const middleCandidates = useMemo(
    () =>
      filteredPlayers
        .filter((p) => playerInDepthGroup(p.positions, selectedPosition))
        .sort(comparePlayersByName),
    [filteredPlayers, selectedPosition]
  );

  const allViews = useMemo(
    () =>
      buildViewsFromCache(
        players,
        depthCache,
        selectedPosition,
        SQUAD_TEAMS.map((t) => t.id)
      ),
    [players, depthCache, selectedPosition]
  );

  /** All-players middle: teams at the selected position only (no Available). */
  const teamPositionSections = useMemo(
    () =>
      allViews.positionSections.filter(
        (section) => section.squadTeam != null && !section.rankPool
      ),
    [allViews.positionSections]
  );

  const showingAllPlayers = filter === 'all';

  const squadView = useMemo(() => {
    if (filter === 'all' || !isSquadTeamFilter(filter)) {
      return null;
    }
    return getSquadDepthViewFromCache({
      squadPlayers: squadOnlyPlayers,
      cache: depthCache[filter],
      positionNumber: selectedPosition,
    });
  }, [filter, squadOnlyPlayers, depthCache, selectedPosition]);
  const starterElsewhereByPlayer = useMemo(() => {
    if (!squadView) return {};
    const currentGroup = getDepthPositionGroup(selectedPosition);
    const result: Record<string, string[]> = {};
    for (const [playerId, positions] of Object.entries(
      squadView.starterPositionsByPlayer
    )) {
      const labels = positions
        .filter((n) => !currentGroup.includes(n))
        .map((n) => formatDepthGroupLabel(n));
      if (labels.length > 0) result[playerId] = labels;
    }
    return result;
  }, [squadView, selectedPosition]);

  /** All-players middle: ★ for starters elsewhere across every squad. */
  const allStarterElsewhereByPlayer = useMemo(() => {
    if (filter !== 'all') return {};
    const currentGroup = getDepthPositionGroup(selectedPosition);
    const result: Record<string, string[]> = {};
    for (const team of SQUAD_TEAMS) {
      const view = getSquadDepthViewFromCache({
        squadPlayers: players.filter((p) => p.squad_team === team.id),
        cache: depthCache[team.id],
        positionNumber: selectedPosition,
      });
      for (const [playerId, positions] of Object.entries(
        view.starterPositionsByPlayer
      )) {
        const labels = positions
          .filter((n) => !currentGroup.includes(n))
          .map((n) => formatDepthGroupLabel(n));
        if (labels.length === 0) continue;
        const existing = result[playerId] ?? [];
        for (const label of labels) {
          if (!existing.includes(label)) existing.push(label);
        }
        result[playerId] = existing;
      }
    }
    return result;
  }, [filter, players, depthCache, selectedPosition]);

  const starterSlots = squadView?.starterSlots ?? [];
  const starterSection = useMemo(
    () => [
      {
        title: '',
        rows: starterSlots.map((slot) => ({
          key: slot.key,
          player: slot.player,
          role: slot.label,
          slotLabel: slot.label,
        })),
      },
    ],
    [starterSlots]
  );

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

  async function handleAddAvailableToPosition(
    player: Player,
    team: SquadTeam
  ) {
    const canonical = getDepthCanonicalPosition(selectedPosition);
    if (!playerInDepthGroup(player.positions, selectedPosition)) {
      const nextPositions = [
        ...new Set([...normalizePositions(player.positions), canonical]),
      ].sort((a, b) => a - b);
      await changePositions(player.id, nextPositions);
    }
    if (player.squad_team !== team) {
      await assignSquad(player.id, team);
    }
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

  async function handleMove(playerId: string, direction: 'up' | 'down') {
    if (!isSquadTeamFilter(filter)) return;
    await moveDepth({
      squadTeam: filter,
      positionNumber: selectedPosition,
      playerId,
      direction,
    });
  }

  async function handleMoveSub(playerId: string, direction: 'up' | 'down') {
    if (!isSquadTeamFilter(filter)) return;
    await moveSub({
      squadTeam: filter,
      playerId,
      direction,
    });
  }

  const orderedAtPosition = squadView?.orderedAtPosition ?? middleCandidates;
  const starters = squadView?.starters ?? [];
  const subs = squadView?.subs ?? [];

  const subtitle = isPhone
    ? canReorder
      ? `Tap a player to edit · ↑ ↓ to reorder · top ${starterCount} start`
      : 'Pick a squad to reorder. All players is read-only.'
    : canReorder
      ? starterCount > 1
        ? `Top ${starterCount} at ${positionLabel} are starters; reorder with ↑ ↓.`
        : `Top player at ${positionLabel} is the starter; reorder with ↑ ↓.`
      : showingAllPlayers
        ? 'Teams at this position in the middle · Available on the right.'
        : 'Pick a squad to reorder depth. All players is read-only.';

  const formationBlock = (
    <View style={[styles.formationBlock, isPhone && styles.formationBlockPhone]}>
      <Text style={styles.colTitle}>Formation</Text>
      <Text style={styles.colHint}>Tap a position to filter the list</Text>
      <FormationPitchPicker
        selected={selectedPosition}
        onSelect={(n) => {
          setSelectedPosition(n);
          if (isPhone) setFormationOpen(false);
        }}
      />
    </View>
  );

  const availableAddTeams: SquadTeam[] =
    canReorder && isSquadTeamFilter(filter)
      ? [filter]
      : addToTeamsForAvailable;

  const availableRankPanel = (
    <PlayerCardList
      sections={availableSection}
      emptyPlayers={availableOrdered.length === 0}
      onPressPlayer={setEditing}
      availableRank={{
        ordered: availableVisible,
        onMove: (player, direction) => {
          void handleMoveAvailable(player, direction);
        },
        onMoveTop: (player) => {
          void moveAvailableToTop({
            playerId: player.id,
            grade: gradeFilter,
            pool: 'available',
          });
        },
        onMoveBottom: (player) => {
          void moveAvailableToBottom({
            playerId: player.id,
            grade: gradeFilter,
            pool: 'available',
          });
        },
        onTogglePin: (player) => {
          void toggleAvailablePin({
            playerId: player.id,
            grade: gradeFilter,
            pool: 'available',
          });
        },
        onAddToTeam: (player, team) => {
          void handleAddAvailableToPosition(player, team);
        },
        addToTeams: availableAddTeams,
        addButtonLabel:
          availableAddTeams.length === 1
            ? `Add to ${positionLabel}`
            : undefined,
        prioritizePosition: selectedPosition,
        positionLabel,
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
  );

  const depthList = (
    <View style={styles.depthBlock}>
      <View style={styles.colTitleRow}>
        <Text style={styles.colTitle}>
          {positionLabel} · {filterLabel}
          {canReorder ? ' · depth order' : ''}
        </Text>
      </View>
      <Text style={styles.colHint}>
        {viewingSquadDepth && !squadDepthReady
          ? 'Loading depth order…'
          : compactLists
            ? canReorder
              ? 'Tap to edit · ↑ ↓ to set starter order'
              : 'Tap a player to edit'
            : canReorder
              ? starterCount > 1
                ? `Use ↑ ↓ — top ${starterCount} are starters, rest are subs`
                : 'Use ↑ ↓ to set starter (top) and subs'
              : 'Varsity → JV → Fr/Soph at this position · edit Positions / Team · pick a squad to reorder'}
      </Text>
      {viewingSquadDepth ? (
        <>
          <DepthPositionList
            players={squadDepthReady ? orderedAtPosition : []}
            canReorder={canReorder && squadDepthReady}
            starterCount={starterCount}
            starterElsewhereByPlayer={
              squadDepthReady ? starterElsewhereByPlayer : {}
            }
            compact={compactLists}
            onPressPlayer={
              canReorder && squadDepthReady && compactLists
                ? setEditing
                : undefined
            }
            onSave={handleSave}
            onAssignSquad={
              canReorder && squadDepthReady && !compactLists
                ? handleAssignSquad
                : undefined
            }
            onMove={handleMove}
          />
          {canReorder && isSquadTeamFilter(filter) ? (
            <View style={styles.availableAtPos}>
              <Text style={styles.colHint}>
                Rank Available like Assign Squads. Add to {positionLabel} puts
                them on {filterLabel} at this position.
              </Text>
              {availableRankPanel}
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.allTeamsDepth}>
          {loading || (!depthReady && players.length > 0) ? (
            <Text style={styles.colHint}>Loading depth order…</Text>
          ) : (
            teamPositionSections.map((section) => {
              const sectionPlayers = section.rows
                .map((row) => row.player)
                .filter((p): p is Player => Boolean(p));
              return (
                <View
                  key={section.squadTeam ?? section.title}
                  style={styles.teamDepthBlock}
                >
                  <Text style={styles.teamDepthTitle}>{section.title}</Text>
                  <DepthPositionList
                    players={sectionPlayers}
                    canReorder={false}
                    starterCount={starterCount}
                    starterElsewhereByPlayer={allStarterElsewhereByPlayer}
                    compact={compactLists}
                    onPressPlayer={compactLists ? setEditing : undefined}
                    onSave={handleSave}
                    onAssignSquad={
                      compactLists ? undefined : handleAssignSquad
                    }
                    onMove={async () => {}}
                    emptyText={`No ${positionLabel} players on ${section.title}.`}
                  />
                </View>
              );
            })
          )}
        </View>
      )}
    </View>
  );

  const benchBlock =
    viewingSquadDepth ? (
      <View style={styles.benchBlock}>
        <View style={styles.subsBreak}>
          <View style={styles.subsLine} />
          <Text style={styles.subsLabel}>Subs · bench order</Text>
          <View style={styles.subsLine} />
        </View>
        <Text style={styles.subsHint}>
          {canReorder
            ? compactLists
              ? 'Tap to edit · ↑ ↓ for #12+'
              : 'Use ↑ ↓ to set #12+'
            : 'Read-only bench order'}
        </Text>
        <DepthPositionList
          players={squadDepthReady ? subs : []}
          canReorder={canReorder && squadDepthReady}
          starterCount={0}
          rankStart={12}
          showRole={false}
          emptyText={
            squadDepthReady
              ? 'No substitutes for this squad.'
              : 'Loading substitutes…'
          }
          compact={compactLists}
          onPressPlayer={
            canReorder && squadDepthReady && compactLists
              ? setEditing
              : undefined
          }
          onSave={handleSave}
          onAssignSquad={
            canReorder && squadDepthReady && !compactLists
              ? handleAssignSquad
              : undefined
          }
          onMove={handleMoveSub}
        />
      </View>
    ) : null;

  const rightXi = showSideXi ? (
    <View style={styles.rightCol}>
      <View style={styles.colTitleRow}>
        <Text style={styles.colTitle}>{filterLabel}</Text>
      </View>
      <Text style={styles.colHint}>
        {canReorder
          ? 'XI starters, then ordered substitutes'
          : 'XI starters and subs (read-only)'}
      </Text>
      <ScrollView
        style={styles.panelScroll}
        contentContainerStyle={styles.panelContent}
        nestedScrollEnabled
      >
        <Text style={styles.sectionLabel}>Starters (XI)</Text>
        <PlayerTable
          players={squadDepthReady ? starters : []}
          onSave={handleSave}
          showDelete={false}
          showRoleColumn={false}
          sections={squadDepthReady ? starterSection : undefined}
        />
        <View style={styles.subsBreak}>
          <View style={styles.subsLine} />
          <Text style={styles.subsLabel}>Subs</Text>
          <View style={styles.subsLine} />
        </View>
        <Text style={styles.subsHint}>
          {canReorder ? 'Use ↑ ↓ to set bench order' : 'Read-only bench order'}
        </Text>
        <DepthPositionList
          players={squadDepthReady ? subs : []}
          canReorder={canReorder && squadDepthReady}
          starterCount={0}
          rankStart={12}
          showRole={false}
          emptyText={
            squadDepthReady
              ? 'No substitutes for this squad.'
              : 'Loading substitutes…'
          }
          onSave={handleSave}
          onAssignSquad={
            canReorder && squadDepthReady ? handleAssignSquad : undefined
          }
          onMove={handleMoveSub}
        />
      </ScrollView>
    </View>
  ) : null;

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarText}>
          <Text style={styles.title}>Depth Chart</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <View style={styles.filterRow}>
          {filters.map((item) => {
            const active = filter === item.key;
            return (
              <Pressable
                key={item.key}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setFilter(item.key)}
              >
                <Text
                  style={[styles.filterText, active && styles.filterTextActive]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {error ? (
        <Pressable onPress={clearError} style={styles.errorBanner}>
          <Text style={styles.error}>{error}</Text>
          <Text style={styles.errorDismiss}>Dismiss</Text>
        </Pressable>
      ) : null}

      {useThreeCol ? (
        <View style={styles.columns}>
          <View style={styles.leftCol}>{formationBlock}</View>
          <View style={styles.middleCol}>
            <ScrollView
              style={styles.panelScroll}
              contentContainerStyle={styles.panelContent}
              nestedScrollEnabled
            >
              {depthList}
              {!showSideXi ? benchBlock : null}
            </ScrollView>
          </View>
          {rightXi}
          {showingAllPlayers ? (
            <View style={styles.rightCol}>
              <Text style={styles.colTitle}>Available</Text>
              <Text style={styles.colHint}>
                {positionLabel} first, then everyone else · Add to team at this
                position
              </Text>
              <ScrollView
                style={styles.panelScroll}
                contentContainerStyle={styles.panelContent}
                nestedScrollEnabled
              >
                {availableRankPanel}
              </ScrollView>
            </View>
          ) : null}
        </View>
      ) : useTwoCol ? (
        <View style={styles.tabletRow}>
          <View style={styles.tabletLeft}>{formationBlock}</View>
          <ScrollView
            style={styles.tabletRight}
            contentContainerStyle={styles.compactContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {depthList}
            {benchBlock}
            {showingAllPlayers ? (
              <View style={styles.allPlayersBlock}>
                <Text style={styles.colTitle}>Available</Text>
                <Text style={styles.colHint}>
                  {positionLabel} first, then everyone else
                </Text>
                {availableRankPanel}
              </View>
            ) : null}
          </ScrollView>
        </View>
      ) : (
        <ScrollView
          style={styles.compactScroll}
          contentContainerStyle={styles.compactContent}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            style={styles.formationToggle}
            onPress={() => setFormationOpen((v) => !v)}
          >
            <Text style={styles.formationToggleText}>
              {formationOpen ? 'Hide formation' : 'Show formation'} ·{' '}
              {positionLabel}
            </Text>
          </Pressable>
          {formationOpen ? formationBlock : null}

          {depthList}
          {benchBlock}

          {showingAllPlayers ? (
            <View style={styles.allPlayersBlock}>
              <Text style={styles.colTitle}>Available</Text>
              <Text style={styles.colHint}>
                {positionLabel} first, then everyone else
              </Text>
              {availableRankPanel}
            </View>
          ) : null}
        </ScrollView>
      )}

      <PlayerEditSheet
        player={editingPlayer}
        visible={Boolean(editing)}
        onClose={() => setEditing(null)}
        onSave={handleSave}
        onAssignSquad={handleAssignSquad}
        onDelete={handleDelete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    gap: 12,
    paddingRight: layout.pagePadding,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
  },
  toolbarText: {
    flex: 1,
    minWidth: 200,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    color: colors.muted,
    marginTop: 2,
    maxWidth: 420,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 13,
  },
  filterTextActive: {
    color: '#fff',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.dangerBg,
    padding: 10,
    borderRadius: 8,
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
  columns: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 0,
  },
  leftCol: {
    width: 280,
    flexShrink: 0,
    gap: 8,
  },
  middleCol: {
    flex: 1.15,
    minWidth: 0,
    gap: 8,
  },
  rightCol: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  formationBlock: {
    gap: 8,
  },
  formationBlockPhone: {
    marginBottom: 4,
  },
  depthBlock: {
    gap: 8,
  },
  allTeamsDepth: {
    gap: 16,
  },
  teamDepthBlock: {
    gap: 6,
  },
  teamDepthTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  availableAtPos: {
    gap: 8,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  benchBlock: {
    gap: 8,
    marginTop: 8,
  },
  readOnlyPanel: {
    opacity: 0.85,
  },
  allPlayersBlock: {
    gap: 8,
    marginTop: 16,
  },
  colTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  colTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
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
  readonlyList: {
    padding: layout.pagePadding,
    gap: 8,
    paddingBottom: 40,
  },
  readonlyRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
  },
  readonlyName: {
    fontWeight: '700',
    color: colors.text,
    fontSize: 15,
  },
  readonlyMeta: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 13,
  },
  emptyText: {
    color: colors.muted,
    marginTop: 12,
  },
  colHint: {
    fontSize: 12,
    color: colors.muted,
    marginTop: -4,
  },
  panelScroll: {
    flex: 1,
    minHeight: 0,
  },
  panelContent: {
    paddingBottom: 24,
    flexGrow: 1,
  },
  compactScroll: {
    flex: 1,
    minHeight: 0,
  },
  compactContent: {
    paddingBottom: 40,
    gap: 16,
  },
  formationToggle: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: layout.radius,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  formationToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  tabletRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 0,
  },
  tabletLeft: {
    width: 280,
    flexShrink: 0,
    gap: 8,
  },
  tabletRight: {
    flex: 1,
    minWidth: 0,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  subsBreak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 12,
  },
  subsLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  subsLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  subsHint: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 8,
  },
});
