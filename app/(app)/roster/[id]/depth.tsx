import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { useActiveRole } from '@/lib/ActiveRoleContext';
import { useAuth } from '@/lib/AuthContext';
import { playersInRankPool } from '@/lib/assignPools';
import {
  filterAvailableByGrade,
  orderAvailablePlayers,
  type GradeFilter,
} from '@/lib/availableRank';
import { confirmAction } from '@/lib/confirm';
import { useMasterConflicts } from '@/lib/MasterConflictContext';
import { useRosterData } from '@/lib/RosterDataContext';
import { useLayout } from '@/lib/layout';
import { mergeLiveSquadPlayers } from '@/lib/adminLiveRoster';
import {
  isMasterKind,
  masterKindForSquad,
  type MasterKind,
} from '@/lib/masterConflicts';
import { ownSquadForWorkspace } from '@/lib/masterWorkspace';
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
  buildFormationSectionFromPlayers,
  buildSimplePositionSections,
  buildSimpleSquadSections,
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
import { SQUAD_TEAMS, UNAVAILABLE_POOL } from '@/lib/types';
import { colors, layout } from '@/constants/theme';

const GRADE_FILTERS: { key: GradeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...CLASS_ORDER_DESC.map((y) => ({ key: y as GradeFilter, label: y })),
];

function positionRows(
  playersAtPos: Player[],
  starterCount: number
): SquadPlayerSection['rows'] {
  return playersAtPos.map((p, index) => ({
    key: p.id,
    player: p,
    role: index < starterCount ? 'Starter' : 'Sub',
  }));
}

type MasterFilter = `master:${MasterKind}`;
type SquadFilter = 'all' | SquadTeam | MasterFilter;

function isMasterFilter(key: SquadFilter): key is MasterFilter {
  return typeof key === 'string' && key.startsWith('master:');
}

function masterKindFromFilter(key: MasterFilter): MasterKind {
  return key.slice('master:'.length) as MasterKind;
}

function isSquadTeamFilter(key: SquadFilter): key is SquadTeam {
  return key === 'varsity' || key === 'jv' || key === 'fr_soph';
}

/** Formation + depth + XI need this much width; below that, drop to 2-col. */
const DEPTH_THREE_COL_MIN = 1280;

export default function DepthChartScreen() {
  const { session, loading: authLoading, configured } = useAuth();
  const { width, isPhone, isTablet, isDesktop } = useLayout();
  const { workspaceKind, isAdminLiveMode } = useActiveRole();
  const {
    officialPlayers,
    depthForMaster,
    otherMasterKinds,
    masterLabel,
    canonicalSquad,
    loading: masterClaimsLoading,
  } = useMasterConflicts();
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

  const isMasterView =
    workspaceKind != null && isMasterKind(workspaceKind);
  const ownSquad = ownSquadForWorkspace(workspaceKind);
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>('all');
  const [sortingAvailable, setSortingAvailable] = useState(false);

  const filters = useMemo((): { key: SquadFilter; label: string }[] => {
    // Admin Live: same single-team depth UI as a head coach, for each master.
    if (isAdminLiveMode) {
      return [
        ...SQUAD_TEAMS.map((t) => ({
          key: t.id as SquadFilter,
          label: t.label,
        })),
        { key: 'all', label: 'All players' },
      ];
    }
    if (isMasterView && ownSquad) {
      const ownLabel =
        SQUAD_TEAMS.find((t) => t.id === ownSquad)?.label ?? ownSquad;
      return [
        { key: ownSquad, label: ownLabel },
        ...otherMasterKinds.map((kind) => ({
          key: `master:${kind}` as MasterFilter,
          label: masterLabel(kind),
        })),
        { key: 'all', label: 'All players' },
      ];
    }
    return [
      { key: 'all', label: 'All players' },
      ...SQUAD_TEAMS.map((t) => ({ key: t.id as SquadFilter, label: t.label })),
    ];
  }, [
    isAdminLiveMode,
    isMasterView,
    ownSquad,
    otherMasterKinds,
    masterLabel,
  ]);

  const [filter, setFilter] = useState<SquadFilter>(
    () => ownSquad ?? (isAdminLiveMode ? 'varsity' : 'all')
  );
  useEffect(() => {
    if (!filters.some((f) => f.key === filter)) {
      // Team-first filters (head coach / Admin Live) default to first team.
      setFilter(filters[0]?.key ?? 'all');
    }
  }, [filters, filter]);
  // Entering Live coaches: land on Varsity depth (editable) like a head coach.
  useEffect(() => {
    if (isAdminLiveMode && filter === 'all') {
      setFilter('varsity');
    }
  }, [isAdminLiveMode]);

  const [selectedPosition, setSelectedPosition] = useState(9);
  const [formationOpen, setFormationOpen] = useState(false);
  const [editing, setEditing] = useState<Player | null>(null);
  /** Phone: cards + sheet. iPad/desktop: inline pos/team table (intentional). */
  const compactLists = isPhone;
  const editingPlayer = useMemo(() => {
    if (!editing) return null;
    return players.find((p) => p.id === editing.id) ?? editing;
  }, [editing, players]);

  const showingOtherMaster = isMasterFilter(filter);
  const canReorder = filter !== 'all' && !showingOtherMaster;
  /** Own team or another master's official squad — same depth UI. */
  const viewingSquadDepth = canReorder || showingOtherMaster;
  /** Other masters use MasterConflict depth cache, not local depthReady. */
  const squadDepthReady = showingOtherMaster
    ? !masterClaimsLoading
    : depthReady;
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
    if (showingOtherMaster) {
      const kind = masterKindFromFilter(filter);
      const squad = canonicalSquad(kind);
      return officialPlayers(kind, players).map((p) => ({
        ...p,
        squad_team: squad,
      }));
    }
    // Admin Live: squad tabs use claims + roster flatten (claims may lag assign).
    if (isAdminLiveMode && isSquadTeamFilter(filter)) {
      const kind = masterKindForSquad(filter);
      const squad = canonicalSquad(kind);
      return mergeLiveSquadPlayers({
        squad,
        claimedPlayers: officialPlayers(kind, players),
        rosterPlayers: players,
      });
    }
    if (filter === 'all') return players;
    // Own team: squad + Available (depth order still squad-only).
    if (isMasterView && ownSquad && filter === ownSquad) {
      return players.filter(
        (p) => p.squad_team === ownSquad || p.squad_team == null
      );
    }
    return players.filter((p) => p.squad_team === filter);
  }, [
    players,
    filter,
    showingOtherMaster,
    officialPlayers,
    canonicalSquad,
    isMasterView,
    isAdminLiveMode,
    ownSquad,
  ]);

  const squadOnlyPlayers = useMemo(() => {
    if (showingOtherMaster) return filteredPlayers;
    if (isAdminLiveMode && isSquadTeamFilter(filter)) return filteredPlayers;
    if (isSquadTeamFilter(filter)) {
      return filteredPlayers.filter((p) => p.squad_team === filter);
    }
    return filteredPlayers;
  }, [filteredPlayers, filter, showingOtherMaster, isAdminLiveMode]);

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

  const addToTeamsForAvailable = useMemo((): SquadTeam[] => {
    if (isMasterView && ownSquad) return [ownSquad];
    return SQUAD_TEAMS.map((t) => t.id);
  }, [isMasterView, ownSquad]);

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

  const allViews = useMemo(() => {
    const starterN = getDepthStarterCount(selectedPosition);

    const appendPools = (
      squadSections: SquadPlayerSection[],
      positionSections: SquadPlayerSection[]
    ) => {
      const available = orderAvailablePlayers(
        players.filter((p) => p.squad_team == null)
      );
      if (available.length > 0) {
        squadSections.push({
          title: 'Available',
          rankPool: 'available',
          rows: available.map((p) => ({ key: p.id, player: p })),
        });
        const availableAtPos = available.filter((p) =>
          playerInDepthGroup(p.positions, selectedPosition)
        );
        if (availableAtPos.length > 0) {
          positionSections.push({
            title: 'Available',
            rankPool: 'available',
            rows: availableAtPos.map((p) => ({ key: p.id, player: p })),
          });
        }
      }

      const unavailable = orderAvailablePlayers(
        players.filter((p) => p.squad_team === UNAVAILABLE_POOL)
      );
      if (unavailable.length > 0) {
        squadSections.push({
          title: 'Unavailable',
          rankPool: 'unavailable',
          rows: unavailable.map((p) => ({ key: p.id, player: p })),
        });
        const unavailableAtPos = unavailable.filter((p) =>
          playerInDepthGroup(p.positions, selectedPosition)
        );
        if (unavailableAtPos.length > 0) {
          positionSections.push({
            title: 'Unavailable',
            rankPool: 'unavailable',
            rows: unavailableAtPos.map((p) => ({ key: p.id, player: p })),
          });
        }
      }
    };

    // Admin Live All: all three masters from official claims (duals on each).
    if (isAdminLiveMode) {
      const positionSections: SquadPlayerSection[] = [];
      const squadSections: SquadPlayerSection[] = [];
      for (const team of SQUAD_TEAMS) {
        const kind = masterKindForSquad(team.id);
        const list = mergeLiveSquadPlayers({
          squad: team.id,
          claimedPlayers: officialPlayers(kind, players),
          rosterPlayers: players,
        });
        const cache = depthCache[team.id] ?? depthForMaster(kind);
        const view = getSquadDepthViewFromCache({
          squadPlayers: list,
          cache,
          positionNumber: selectedPosition,
        });
        squadSections.push(
          buildFormationSectionFromPlayers(team.label, team.id, list, cache)
        );
        positionSections.push({
          title: team.label,
          squadTeam: team.id,
          rows: positionRows(view.orderedAtPosition, starterN),
        });
      }
      appendPools(squadSections, positionSections);
      return { squadSections, positionSections };
    }

    // Head coach All: own team first, then other masters, then Available.
    if (isMasterView && ownSquad) {
      const positionSections: SquadPlayerSection[] = [];
      const squadSections: SquadPlayerSection[] = [];

      const ownLabel =
        SQUAD_TEAMS.find((t) => t.id === ownSquad)?.label ?? ownSquad;
      const ownPlayers = players.filter((p) => p.squad_team === ownSquad);
      const ownView = getSquadDepthViewFromCache({
        squadPlayers: ownPlayers,
        cache: depthCache[ownSquad],
        positionNumber: selectedPosition,
      });
      squadSections.push(
        buildFormationSectionFromPlayers(
          ownLabel,
          ownSquad,
          ownPlayers,
          depthCache[ownSquad]
        )
      );
      positionSections.push({
        title: ownLabel,
        squadTeam: ownSquad,
        rows: positionRows(ownView.orderedAtPosition, starterN),
      });

      for (const kind of otherMasterKinds) {
        const squad = canonicalSquad(kind);
        const label = masterLabel(kind);
        const list = officialPlayers(kind, players).map((p) => ({
          ...p,
          squad_team: squad,
        }));
        const view = getSquadDepthViewFromCache({
          squadPlayers: list,
          cache: depthForMaster(kind),
          positionNumber: selectedPosition,
        });
        squadSections.push(
          buildFormationSectionFromPlayers(
            label,
            squad,
            list,
            depthForMaster(kind),
            { readOnly: true }
          )
        );
        positionSections.push({
          title: label,
          squadTeam: squad,
          readOnly: true,
          rows: positionRows(view.orderedAtPosition, starterN),
        });
      }

      appendPools(squadSections, positionSections);
      return { squadSections, positionSections };
    }

    if (!depthReady) {
      return {
        squadSections: buildSimpleSquadSections(players),
        positionSections: buildSimplePositionSections(
          players,
          selectedPosition
        ),
      };
    }
    return buildViewsFromCache(
      players,
      depthCache,
      selectedPosition,
      isAdminLiveMode ? SQUAD_TEAMS.map((t) => t.id) : []
    );
  }, [
    players,
    depthCache,
    depthReady,
    selectedPosition,
    isMasterView,
    isAdminLiveMode,
    ownSquad,
    otherMasterKinds,
    officialPlayers,
    depthForMaster,
    canonicalSquad,
    masterLabel,
  ]);

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
    if (showingOtherMaster) {
      const kind = masterKindFromFilter(filter);
      return getSquadDepthViewFromCache({
        squadPlayers: squadOnlyPlayers,
        cache: depthForMaster(kind),
        positionNumber: selectedPosition,
      });
    }
    if (filter === 'all' || !isSquadTeamFilter(filter)) {
      return null;
    }
    const cache = isAdminLiveMode
      ? (depthCache[filter] ?? depthForMaster(masterKindForSquad(filter)))
      : depthCache[filter];
    return getSquadDepthViewFromCache({
      squadPlayers: squadOnlyPlayers,
      cache,
      positionNumber: selectedPosition,
    });
  }, [
    filter,
    squadOnlyPlayers,
    depthCache,
    selectedPosition,
    showingOtherMaster,
    depthForMaster,
    isAdminLiveMode,
  ]);

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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
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
      : showingOtherMaster
        ? `${filterLabel} is read-only · pick your team to edit depth`
        : 'Pick your team to reorder. All players is read-only.'
    : canReorder
      ? starterCount > 1
        ? `Top ${starterCount} at ${positionLabel} are starters; reorder with ↑ ↓.`
        : `Top player at ${positionLabel} is the starter; reorder with ↑ ↓.`
      : showingOtherMaster
        ? `${filterLabel} depth is live and read-only. Switch to your team to edit.`
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
    <View
      style={[styles.depthBlock, showingOtherMaster && styles.readOnlyPanel]}
    >
      <View style={styles.colTitleRow}>
        <Text style={styles.colTitle}>
          {positionLabel} · {filterLabel}
          {canReorder ? ' · depth order' : ''}
        </Text>
        {showingOtherMaster ? (
          <Text style={styles.readOnlyBadge}>Read-only</Text>
        ) : null}
      </View>
      <Text style={styles.colHint}>
        {viewingSquadDepth && !squadDepthReady
          ? 'Loading depth order…'
          : compactLists
            ? canReorder
              ? 'Tap to edit · ↑ ↓ to set starter order'
              : showingOtherMaster
                ? 'Read-only depth order from this master'
                : 'Tap a player to edit'
            : canReorder
              ? starterCount > 1
                ? `Use ↑ ↓ — top ${starterCount} are starters, rest are subs`
                : 'Use ↑ ↓ to set starter (top) and subs'
              : showingOtherMaster
                ? 'Official depth order · not editable here'
                : 'Varsity → JV → Fr/Soph at this position · pick a squad to reorder'}
      </Text>
      {viewingSquadDepth && !squadDepthReady ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
      ) : viewingSquadDepth ? (
        <>
          <DepthPositionList
            players={orderedAtPosition}
            canReorder={canReorder}
            starterCount={starterCount}
            starterElsewhereByPlayer={starterElsewhereByPlayer}
            compact={compactLists}
            onPressPlayer={
              canReorder && compactLists ? setEditing : undefined
            }
            onSave={handleSave}
            onAssignSquad={
              canReorder && !compactLists ? handleAssignSquad : undefined
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
      ) : compactLists ? (
        <PlayerCardList
          sections={
            showingAllPlayers
              ? teamPositionSections
              : allViews.positionSections
          }
          sectionsPending={
            isMasterView
              ? masterClaimsLoading
              : !depthReady && players.length > 0
          }
          emptyPlayers={middleCandidates.length === 0}
          onPressPlayer={setEditing}
        />
      ) : (
        <PlayerTable
          players={middleCandidates}
          onSave={handleSave}
          showRankColumns={false}
          showDelete={false}
          sections={
            showingAllPlayers
              ? teamPositionSections
              : allViews.positionSections
          }
          sectionsPending={
            isMasterView
              ? masterClaimsLoading
              : !depthReady && players.length > 0
          }
        />
      )}
    </View>
  );

  const benchBlock =
    viewingSquadDepth && squadDepthReady ? (
      <View
        style={[styles.benchBlock, showingOtherMaster && styles.readOnlyPanel]}
      >
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
          players={subs}
          canReorder={canReorder}
          starterCount={0}
          rankStart={12}
          showRole={false}
          emptyText="No substitutes for this squad."
          compact={compactLists}
          onPressPlayer={
            canReorder && compactLists ? setEditing : undefined
          }
          onSave={handleSave}
          onAssignSquad={
            canReorder && !compactLists ? handleAssignSquad : undefined
          }
          onMove={handleMoveSub}
        />
      </View>
    ) : null;

  const rightXi = showSideXi && squadDepthReady ? (
    <View
      style={[styles.rightCol, showingOtherMaster && styles.readOnlyPanel]}
    >
      <View style={styles.colTitleRow}>
        <Text style={styles.colTitle}>{filterLabel}</Text>
        {showingOtherMaster ? (
          <Text style={styles.readOnlyBadge}>Read-only</Text>
        ) : null}
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
          players={starters}
          onSave={handleSave}
          showRankColumns={false}
          showDelete={false}
          showRoleColumn={false}
          sections={starterSection}
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
          players={subs}
          canReorder={canReorder}
          starterCount={0}
          rankStart={12}
          showRole={false}
          emptyText="No substitutes for this squad."
          onSave={handleSave}
          onAssignSquad={canReorder ? handleAssignSquad : undefined}
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
              {/* Wide layout keeps XI+subs on the right; keep bench here too when
                  the side column is absent so Live/coach parity holds. */}
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
    gap: 12,
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
    gap: 16,
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
