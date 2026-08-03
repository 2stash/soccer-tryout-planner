import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { confirmAction } from '@/lib/confirm';
import {
  adminLiveSetPoolRanks,
  buildLiveRosterViews,
  fetchLiveMasterState,
  mergeLiveSquadPlayers,
  type LiveMasterState,
} from '@/lib/adminLiveRoster';
import {
  masterKindForSquad,
  otherClaimLabels,
  MASTER_KINDS,
  type MasterKind,
} from '@/lib/masterConflicts';
import {
  filterAvailableByGrade,
  moveAvailableInFilter,
  moveAvailableToBottom,
  moveAvailableToTop,
  orderAvailablePlayers,
  resetAvailableDefaultOrder,
  toggleAvailablePin,
  type GradeFilter,
  type AvailableRankPlan,
} from '@/lib/availableRank';
import { rankPoolLabel, type RankPool } from '@/lib/assignPools';
import { useActiveRole } from '@/lib/ActiveRoleContext';
import { useLayout } from '@/lib/layout';
import { useMasterConflicts } from '@/lib/MasterConflictContext';
import { useRosterData } from '@/lib/RosterDataContext';
import { formatPositionsShort } from '@/lib/positions';
import {
  CLASS_ORDER_DESC,
  countBySchoolYear,
  formatClassCounts,
} from '@/lib/schoolYear';
import type { Player, PlayerAssignment, SquadTeam } from '@/lib/types';
import { SQUAD_TEAMS, UNAVAILABLE_POOL } from '@/lib/types';
import { colors, layout } from '@/constants/theme';

type PoolKey = RankPool | SquadTeam;

const GRADE_FILTERS: { key: GradeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...CLASS_ORDER_DESC.map((y) => ({ key: y as GradeFilter, label: y })),
];

const THREE_TEAM_COLS_MIN = 900;

function playerMeta(p: Player, opts?: { omitYear?: boolean }) {
  const parts: string[] = [];
  if (!opts?.omitYear && p.school_year) parts.push(p.school_year);
  const pos = formatPositionsShort(p.positions);
  if (pos) parts.push(pos);
  return parts.join(' · ');
}

function teamBtnLabel(teamId: SquadTeam, short: boolean) {
  if (!short) {
    return SQUAD_TEAMS.find((t) => t.id === teamId)?.label ?? teamId;
  }
  if (teamId === 'varsity') return 'Var';
  if (teamId === 'jv') return 'JV';
  return 'Fr';
}

function applyRankPlan(list: Player[], plan: AvailableRankPlan[]): Player[] {
  const byId = new Map(plan.map((r) => [r.playerId, r]));
  return list.map((p) => {
    const row = byId.get(p.id);
    if (!row) return p;
    return {
      ...p,
      team_rank: row.team_rank,
      available_pinned: row.available_pinned,
    };
  });
}

export function AdminLiveAssign() {
  const { width, isPhone, isCompact } = useLayout();
  const { workspaces } = useActiveRole();
  const {
    claimsRevision,
    claimsByPlayer,
    officialPlayers,
    masterWorkspacesList,
    loading: claimsLoading,
  } = useMasterConflicts();
  const {
    roster,
    players,
    loading: playersLoading,
    assignSquad,
    removeFromLiveTeam,
  } = useRosterData();

  const [poolState, setPoolState] = useState<LiveMasterState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sortingPool, setSortingPool] = useState<RankPool | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [phoneTab, setPhoneTab] = useState<PoolKey>('available');
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>('all');
  /** Optimistic override after rank ops until next fetch. */
  const [rankOverride, setRankOverride] = useState<{
    available: Player[] | null;
    unavailable: Player[] | null;
  }>({ available: null, unavailable: null });

  const threeTeamCols = !isPhone && width >= THREE_TEAM_COLS_MIN;
  const tightTeamRows = threeTeamCols;
  const masters =
    masterWorkspacesList.length > 0
      ? masterWorkspacesList
      : workspaces.filter((w) =>
          MASTER_KINDS.includes(w.kind as MasterKind)
        );

  const reloadPools = useCallback(async () => {
    try {
      const next = await fetchLiveMasterState(workspaces);
      setPoolState(next);
      setRankOverride({ available: null, unavailable: null });
    } catch (e) {
      // Keep prior pool state when possible; otherwise empty pools.
      setPoolState((prev) =>
        prev ?? {
          masters: workspaces.filter((w) =>
            MASTER_KINDS.includes(w.kind as MasterKind)
          ),
          claimsByPlayer: new Map(),
          assignmentsByWorkspace: new Map(),
        }
      );
      setLocalError(
        e instanceof Error ? e.message : 'Failed to load live pool state'
      );
    }
  }, [workspaces]);

  useEffect(() => {
    void reloadPools();
  }, [reloadPools, claimsRevision]);

  // Drop stale rank overrides whenever official claims change.
  useEffect(() => {
    setRankOverride({ available: null, unavailable: null });
  }, [claimsRevision]);

  /** Team columns come from live master claims + roster flatten (claims may lag). */
  const byTeam = useMemo(() => {
    const map: Record<SquadTeam, Player[]> = {
      varsity: mergeLiveSquadPlayers({
        squad: 'varsity',
        claimedPlayers: officialPlayers('master_varsity', players),
        rosterPlayers: players,
      }),
      jv: mergeLiveSquadPlayers({
        squad: 'jv',
        claimedPlayers: officialPlayers('master_jv', players),
        rosterPlayers: players,
      }),
      fr_soph: mergeLiveSquadPlayers({
        squad: 'fr_soph',
        claimedPlayers: officialPlayers('master_fr_soph', players),
        rosterPlayers: players,
      }),
    };
    return map;
  }, [officialPlayers, players, claimsRevision]);

  const poolViews = useMemo(() => {
    if (!poolState) {
      return { available: [] as Player[], unavailable: [] as Player[] };
    }
    // Reuse builder but force claims from MasterConflict so teams/pools agree.
    const built = buildLiveRosterViews(players, {
      ...poolState,
      masters: masters.length > 0 ? masters : poolState.masters,
      claimsByPlayer,
    });
    const claimedIds = new Set(claimsByPlayer.keys());
    // Also hide anyone already on a team column (roster flatten may lead claims).
    for (const team of SQUAD_TEAMS) {
      for (const p of byTeam[team.id]) claimedIds.add(p.id);
    }
    const available = (rankOverride.available ?? built.available).filter(
      (p) => !claimedIds.has(p.id)
    );
    const unavailable = (rankOverride.unavailable ?? built.unavailable).filter(
      (p) => !claimedIds.has(p.id)
    );
    return { available, unavailable };
  }, [
    poolState,
    players,
    masters,
    claimsByPlayer,
    rankOverride,
    byTeam,
  ]);

  const views = useMemo(
    () => ({
      byTeam,
      available: poolViews.available,
      unavailable: poolViews.unavailable,
    }),
    [byTeam, poolViews]
  );

  const availablePlayers = useMemo(
    () => orderAvailablePlayers(views.available),
    [views.available]
  );
  const unavailablePlayers = useMemo(
    () => orderAvailablePlayers(views.unavailable),
    [views.unavailable]
  );

  const availableVisible = useMemo(
    () => filterAvailableByGrade(availablePlayers, gradeFilter),
    [availablePlayers, gradeFilter]
  );
  const unavailableVisible = useMemo(
    () => filterAvailableByGrade(unavailablePlayers, gradeFilter),
    [unavailablePlayers, gradeFilter]
  );

  const availableClassCounts = useMemo(
    () => countBySchoolYear(availablePlayers),
    [availablePlayers]
  );
  const unavailableClassCounts = useMemo(
    () => countBySchoolYear(unavailablePlayers),
    [unavailablePlayers]
  );

  async function assign(player: Player, team: PlayerAssignment | null) {
    if (masters.length === 0) {
      setLocalError('Master workspaces not loaded yet.');
      return;
    }
    setBusyId(player.id);
    setLocalError(null);
    try {
      // RosterData path refreshes claims + live flatten after the write.
      await assignSquad(player.id, team);
      await reloadPools();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to update squad');
    } finally {
      setBusyId(null);
    }
  }

  /** Remove from this team only — leaves other masters' claims (conflicts) intact. */
  async function removeFromTeam(player: Player, team: SquadTeam) {
    if (masters.length === 0) {
      setLocalError('Master workspaces not loaded yet.');
      return;
    }
    setBusyId(player.id);
    setLocalError(null);
    try {
      await removeFromLiveTeam(player.id, team);
      await reloadPools();
    } catch (e) {
      setLocalError(
        e instanceof Error ? e.message : 'Failed to remove from team'
      );
    } finally {
      setBusyId(null);
    }
  }

  function rankedList(poolKey: RankPool) {
    return poolKey === 'unavailable' ? unavailablePlayers : availablePlayers;
  }

  function rankedVisible(poolKey: RankPool) {
    return poolKey === 'unavailable' ? unavailableVisible : availableVisible;
  }

  function rankedClassCounts(poolKey: RankPool) {
    return poolKey === 'unavailable'
      ? unavailableClassCounts
      : availableClassCounts;
  }

  async function applyPoolPlan(poolKey: RankPool, plan: AvailableRankPlan[]) {
    if (masters.length === 0 || plan.length === 0) return;
    const list = rankedList(poolKey);
    setRankOverride((prev) => ({
      ...prev,
      [poolKey]: applyRankPlan(list, plan),
    }));
    await adminLiveSetPoolRanks({
      masters,
      ranks: plan,
    });
  }

  async function runRankAction(
    playerId: string,
    poolKey: RankPool,
    build: () => AvailableRankPlan[] | null
  ) {
    setBusyId(playerId);
    setLocalError(null);
    try {
      const plan = build();
      if (!plan) return;
      await applyPoolPlan(poolKey, plan);
    } catch (e) {
      setLocalError(
        e instanceof Error ? e.message : 'Failed to update ranking'
      );
      await reloadPools();
    } finally {
      setBusyId(null);
    }
  }

  function confirmResetAvailableOrder(poolKey: RankPool) {
    const list = rankedList(poolKey);
    if (list.length === 0 || sortingPool) return;
    const label = rankPoolLabel(poolKey);
    confirmAction({
      title: `Reset ${label} order?`,
      message:
        'This sorts unstarred players by class (Sr→Fr) then name. Starred players stay at the top in their current order. Your custom ranking of unstarred players will be lost.',
      confirmLabel: 'Sort',
      onConfirm: () => {
        void (async () => {
          setSortingPool(poolKey);
          setLocalError(null);
          try {
            const plan = resetAvailableDefaultOrder(list);
            await applyPoolPlan(poolKey, plan);
          } catch (e) {
            setLocalError(
              e instanceof Error ? e.message : `Failed to sort ${label}`
            );
          } finally {
            setSortingPool(null);
          }
        })();
      },
    });
  }

  function classCountsLine(list: Player[]) {
    return formatClassCounts(list);
  }

  const poolTabs: { key: PoolKey; label: string }[] = [
    { key: 'available', label: 'Available' },
    { key: 'unavailable', label: 'Unavailable' },
    ...SQUAD_TEAMS.map((t) => ({ key: t.id as SquadTeam, label: t.label })),
  ];

  // Do not block on poolState — teams come from claims; pools can fill in after.
  const loading = (playersLoading || claimsLoading) && players.length === 0;

  function renderRankedActions(player: Player, busy: boolean, poolKey: RankPool) {
    const otherPool: PlayerAssignment | null =
      poolKey === 'available' ? UNAVAILABLE_POOL : null;
    const otherLabel = poolKey === 'available' ? 'Unavail' : 'Available';
    return (
      <View style={[styles.actions, isPhone && styles.actionsFill]}>
        {SQUAD_TEAMS.map((team) => (
          <Pressable
            key={team.id}
            style={[
              isPhone ? styles.phonePrimaryBtn : styles.primaryBtn,
              busy && styles.disabled,
            ]}
            disabled={busy}
            onPress={() => void assign(player, team.id)}
          >
            <Text
              style={
                isPhone ? styles.phonePrimaryBtnText : styles.primaryBtnText
              }
            >
              {team.label}
            </Text>
          </Pressable>
        ))}
        <Pressable
          style={[
            isPhone ? styles.phoneGhostBtn : styles.ghostBtn,
            busy && styles.disabled,
          ]}
          disabled={busy}
          onPress={() => void assign(player, otherPool)}
        >
          <Text
            style={isPhone ? styles.phoneGhostBtnText : styles.ghostBtnText}
          >
            {otherLabel}
          </Text>
        </Pressable>
      </View>
    );
  }

  function renderTeamActions(
    player: Player,
    current: SquadTeam,
    busy: boolean
  ) {
    const short = tightTeamRows;
    const others = SQUAD_TEAMS.filter((t) => t.id !== current);
    return (
      <View
        style={[
          styles.actions,
          (isPhone || tightTeamRows) && styles.actionsFill,
        ]}
      >
        {others.map((team) => (
          <Pressable
            key={team.id}
            style={[
              isPhone
                ? styles.phoneGhostBtn
                : short
                  ? styles.tightGhostBtn
                  : styles.ghostBtn,
              busy && styles.disabled,
            ]}
            disabled={busy}
            onPress={() => void assign(player, team.id)}
          >
            <Text
              style={
                isPhone
                  ? styles.phoneGhostBtnText
                  : short
                    ? styles.tightGhostBtnText
                    : styles.ghostBtnText
              }
            >
              {teamBtnLabel(team.id, short)}
            </Text>
          </Pressable>
        ))}
        <Pressable
          style={[
            isPhone
              ? styles.phoneGhostBtn
              : short
                ? styles.tightGhostBtn
                : styles.ghostBtn,
            busy && styles.disabled,
          ]}
          disabled={busy}
          onPress={() => void assign(player, UNAVAILABLE_POOL)}
        >
          <Text
            style={
              isPhone
                ? styles.phoneGhostBtnText
                : short
                  ? styles.tightGhostBtnText
                  : styles.ghostBtnText
            }
          >
            {short ? 'Out' : 'Unavail'}
          </Text>
        </Pressable>
        <Pressable
          style={[
            isPhone
              ? styles.phoneRemoveBtn
              : short
                ? styles.tightRemoveBtn
                : styles.removeBtn,
            busy && styles.disabled,
          ]}
          disabled={busy}
          onPress={() => void removeFromTeam(player, current)}
        >
          <Text
            style={
              isPhone
                ? styles.phoneRemoveBtnText
                : short
                  ? styles.tightRemoveBtnText
                  : styles.removeBtnText
            }
          >
            Remove
          </Text>
        </Pressable>
      </View>
    );
  }

  function renderConflictHint(playerId: string, team: SquadTeam) {
    const claims = claimsByPlayer.get(playerId) ?? [];
    const labels = otherClaimLabels({
      claims,
      excludeKind: masterKindForSquad(team),
    });
    if (labels.length === 0) return null;
    return (
      <Text style={styles.conflictHint} numberOfLines={1}>
        Also {labels.join(' · ')}
      </Text>
    );
  }

  function renderRankedRow(
    player: Player,
    index: number,
    total: number,
    poolKey: RankPool
  ) {
    const visible = rankedVisible(poolKey);
    const meta = playerMeta(player, { omitYear: gradeFilter !== 'all' });
    const busy = busyId === player.id;
    const rank = index + 1;
    const pinned = Boolean(player.available_pinned);
    const stacked = isPhone;
    const prev = index > 0 ? visible[index - 1] : null;
    const next = index < total - 1 ? visible[index + 1] : null;
    const canUp = index > 0 && Boolean(prev?.available_pinned) === pinned;
    const canDown =
      index < total - 1 && Boolean(next?.available_pinned) === pinned;
    const firstUnpinnedIdx = visible.findIndex((p) => !p.available_pinned);
    const canTop = pinned
      ? index > 0
      : firstUnpinnedIdx >= 0 && index > firstUnpinnedIdx;
    let lastPinnedIdx = -1;
    visible.forEach((p, i) => {
      if (p.available_pinned) lastPinnedIdx = i;
    });
    const canBottom = pinned
      ? index < lastPinnedIdx
      : index < total - 1;

    return (
      <View
        key={player.id}
        style={[
          styles.row,
          stacked && styles.stackedRow,
          pinned && styles.rowPinned,
          index % 2 === 1 && !pinned && styles.rowAlt,
          busy && styles.rowBusy,
        ]}
      >
        <View style={styles.rankCol}>
          <Pressable
            style={[styles.starBtn, pinned && styles.starBtnOn]}
            disabled={busy}
            onPress={() =>
              void runRankAction(player.id, poolKey, () =>
                toggleAvailablePin({
                  available: rankedList(poolKey),
                  grade: gradeFilter,
                  playerId: player.id,
                })
              )
            }
            hitSlop={6}
          >
            <Text style={[styles.starBtnText, pinned && styles.starBtnTextOn]}>
              {pinned ? '★' : '☆'}
            </Text>
          </Pressable>
          <Text style={[styles.rankBadge, pinned && styles.rankBadgePinned]}>
            #{rank}
          </Text>
          <View style={styles.moveCol}>
            <Pressable
              style={[styles.moveBtn, !canUp && styles.moveDisabled]}
              disabled={busy || !canUp}
              onPress={() =>
                void runRankAction(player.id, poolKey, () =>
                  moveAvailableInFilter({
                    available: rankedList(poolKey),
                    grade: gradeFilter,
                    playerId: player.id,
                    direction: 'up',
                  })
                )
              }
            >
              <Text style={styles.moveBtnText}>↑</Text>
            </Pressable>
            <Pressable
              style={[styles.moveBtn, !canDown && styles.moveDisabled]}
              disabled={busy || !canDown}
              onPress={() =>
                void runRankAction(player.id, poolKey, () =>
                  moveAvailableInFilter({
                    available: rankedList(poolKey),
                    grade: gradeFilter,
                    playerId: player.id,
                    direction: 'down',
                  })
                )
              }
            >
              <Text style={styles.moveBtnText}>↓</Text>
            </Pressable>
          </View>
          <View style={styles.moveCol}>
            <Pressable
              style={[styles.moveBtn, !canTop && styles.moveDisabled]}
              disabled={busy || !canTop}
              onPress={() =>
                void runRankAction(player.id, poolKey, () =>
                  moveAvailableToTop({
                    available: rankedList(poolKey),
                    grade: gradeFilter,
                    playerId: player.id,
                  })
                )
              }
            >
              <Text style={styles.moveBtnText}>⇈</Text>
            </Pressable>
            <Pressable
              style={[styles.moveBtn, !canBottom && styles.moveDisabled]}
              disabled={busy || !canBottom}
              onPress={() =>
                void runRankAction(player.id, poolKey, () =>
                  moveAvailableToBottom({
                    available: rankedList(poolKey),
                    grade: gradeFilter,
                    playerId: player.id,
                  })
                )
              }
            >
              <Text style={styles.moveBtnText}>⇊</Text>
            </Pressable>
          </View>
        </View>
        <View style={[styles.playerCell, stacked && styles.playerCellStacked]}>
          <Text style={styles.playerName} numberOfLines={1}>
            {player.last_name}, {player.first_name}
          </Text>
          {meta ? (
            <Text style={styles.playerMeta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        {renderRankedActions(player, busy, poolKey)}
      </View>
    );
  }

  function renderTeamRow(player: Player, index: number, team: SquadTeam) {
    const meta = playerMeta(player);
    const busy = busyId === player.id;
    const stacked = isPhone || tightTeamRows;
    const conflicted =
      (claimsByPlayer.get(player.id)?.length ?? 0) > 1;
    return (
      <View
        key={player.id}
        style={[
          styles.row,
          stacked && styles.stackedRow,
          index % 2 === 1 && styles.rowAlt,
          conflicted && styles.rowConflict,
          busy && styles.rowBusy,
        ]}
      >
        <View style={[styles.playerCell, stacked && styles.playerCellStacked]}>
          <Text style={styles.playerName} numberOfLines={1}>
            {player.last_name}, {player.first_name}
          </Text>
          {meta ? (
            <Text style={styles.playerMeta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          {renderConflictHint(player.id, team)}
        </View>
        {renderTeamActions(player, team, busy)}
      </View>
    );
  }

  function renderRankedPanel(poolKey: RankPool) {
    const all = rankedList(poolKey);
    const visible = rankedVisible(poolKey);
    const classCounts = rankedClassCounts(poolKey);
    const counts = classCountsLine(all);
    const label = rankPoolLabel(poolKey);
    const sorting = sortingPool === poolKey;
    return (
      <View style={[styles.panel, !isPhone && styles.rankedPanel]}>
        <View style={styles.panelHeader}>
          <View style={styles.panelTitleBlock}>
            <Text style={styles.sectionTitle}>{label}</Text>
            {counts ? (
              <Text style={styles.classCounts} numberOfLines={2}>
                {counts}
              </Text>
            ) : null}
          </View>
          <Text style={styles.count}>{visible.length}</Text>
        </View>
        <View style={styles.gradeRow}>
          {GRADE_FILTERS.map((tab) => {
            const active = gradeFilter === tab.key;
            const count =
              tab.key === 'all' ? all.length : classCounts[tab.key];
            return (
              <Pressable
                key={tab.key}
                style={[styles.gradeChip, active && styles.gradeChipActive]}
                onPress={() => setGradeFilter(tab.key)}
              >
                <Text
                  style={[styles.gradeText, active && styles.gradeTextActive]}
                >
                  {tab.key === 'all' ? `All ${count}` : `${tab.label} ${count}`}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            style={[styles.sortBtn, sorting && styles.moveDisabled]}
            disabled={Boolean(sortingPool) || all.length === 0}
            onPress={() => confirmResetAvailableOrder(poolKey)}
          >
            <Text style={styles.sortBtnText}>
              {sorting ? 'Sorting…' : 'Sort'}
            </Text>
          </Pressable>
        </View>
        {visible.length === 0 ? (
          <Text style={styles.empty}>
            {all.length === 0
              ? `No players in ${label}.`
              : `No ${gradeFilter === 'all' ? '' : gradeFilter + ' '}players in ${label}.`}
          </Text>
        ) : (
          <View style={styles.list}>
            {visible.map((player, index) =>
              renderRankedRow(player, index, visible.length, poolKey)
            )}
          </View>
        )}
      </View>
    );
  }

  function renderTeamPanel(teamId: SquadTeam) {
    const label =
      SQUAD_TEAMS.find((t) => t.id === teamId)?.label ?? teamId;
    const list = views.byTeam[teamId];
    const counts = classCountsLine(list);
    return (
      <View
        key={teamId}
        style={[
          styles.panel,
          styles.teamPanel,
          threeTeamCols && styles.teamPanelThird,
        ]}
      >
        <View style={styles.panelHeader}>
          <View style={styles.panelTitleBlock}>
            <Text style={styles.sectionTitle}>{label}</Text>
            {counts ? (
              <Text style={styles.classCounts} numberOfLines={2}>
                {counts}
              </Text>
            ) : null}
          </View>
          <Text style={styles.count}>{list.length}</Text>
        </View>
        {list.length === 0 ? (
          <Text style={styles.empty}>No players yet</Text>
        ) : (
          <View style={styles.list}>
            {list.map((player, index) =>
              renderTeamRow(player, index, teamId)
            )}
          </View>
        )}
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      </View>
    );
  }

  const phonePoolCounts =
    phoneTab === 'available'
      ? classCountsLine(availablePlayers)
      : phoneTab === 'unavailable'
        ? classCountsLine(unavailablePlayers)
        : classCountsLine(views.byTeam[phoneTab]);

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
            {roster
              ? `${roster.name} · Live coaches`
              : 'Live coaches'}
          </Text>
          <Text style={styles.sub}>
            Assign across Varsity, JV, and Fr/Soph at once. Existing
            conflicts stay until you fix them (Remove from one team, or pick
            a single team / Available / Unavailable). New dual claims are not
            created. Available and Unavailable only list players on no team.
          </Text>
          <Text style={styles.masterStatus}>
            {masters.length === 3
              ? `Live masters loaded · Varsity ${byTeam.varsity.length} · JV ${byTeam.jv.length} · Fr/Soph ${byTeam.fr_soph.length}`
              : masters.length === 0
                ? 'No master workspaces found for this roster.'
                : `Loaded ${masters.length}/3 master workspaces.`}
          </Text>

          {localError ? (
            <View style={styles.errorBox}>
              <Text style={styles.error}>{localError}</Text>
              <Pressable onPress={() => setLocalError(null)}>
                <Text style={styles.errorDismiss}>Dismiss</Text>
              </Pressable>
            </View>
          ) : null}

          {isPhone ? (
            <>
              <View style={styles.segmentRow}>
                {poolTabs.map((tab) => {
                  const active = phoneTab === tab.key;
                  const count =
                    tab.key === 'available'
                      ? availablePlayers.length
                      : tab.key === 'unavailable'
                        ? unavailablePlayers.length
                        : views.byTeam[tab.key].length;
                  return (
                    <Pressable
                      key={tab.key}
                      style={[
                        styles.segmentChip,
                        active && styles.segmentChipActive,
                      ]}
                      onPress={() => setPhoneTab(tab.key)}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          active && styles.segmentTextActive,
                        ]}
                      >
                        {tab.label}
                      </Text>
                      <Text
                        style={[
                          styles.segmentCount,
                          active && styles.segmentTextActive,
                        ]}
                      >
                        {count}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {phoneTab === 'available' || phoneTab === 'unavailable' ? (
                renderRankedPanel(phoneTab)
              ) : (
                renderTeamPanel(phoneTab)
              )}
              {phonePoolCounts ? (
                <Text style={styles.phoneCounts}>{phonePoolCounts}</Text>
              ) : null}
            </>
          ) : (
            <>
              <View style={styles.rankedRow}>
                {renderRankedPanel('available')}
                {renderRankedPanel('unavailable')}
              </View>
              <View
                style={[
                  styles.teamsRow,
                  threeTeamCols && styles.teamsRowThree,
                ]}
              >
                {SQUAD_TEAMS.map((t) => renderTeamPanel(t.id))}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
    alignItems: 'center',
  },
  scrollContentCompact: {
    paddingHorizontal: 12,
  },
  content: {
    width: '100%',
    maxWidth: 1100,
    gap: 14,
  },
  heading: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  sub: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
    marginTop: -6,
  },
  masterStatus: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    marginTop: -4,
  },
  errorBox: {
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
  segmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  segmentChip: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 72,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: layout.radius,
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 2,
  },
  segmentChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
  },
  segmentCount: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
  },
  segmentTextActive: {
    color: colors.primaryText,
  },
  phoneCounts: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
  },
  rankedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'stretch',
  },
  rankedPanel: {
    flexGrow: 1,
    flexBasis: 320,
    minWidth: 280,
  },
  panel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  teamPanel: {
    flexGrow: 1,
    flexBasis: 280,
    minWidth: 240,
    minHeight: 140,
  },
  teamPanelThird: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: '#e8eef3',
  },
  panelTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  sectionTitle: {
    fontWeight: '800',
    fontSize: 15,
    color: colors.text,
  },
  classCounts: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
  },
  count: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  sortBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
  gradeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: '#f7f9fb',
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
  empty: {
    color: colors.muted,
    fontSize: 13,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  list: {
    borderTopWidth: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  stackedRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
    paddingVertical: 12,
  },
  rowAlt: {
    backgroundColor: '#f7f9fb',
  },
  rowPinned: {
    backgroundColor: '#fff8e8',
  },
  rowConflict: {
    backgroundColor: '#fff8e8',
  },
  conflictHint: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '800',
    color: colors.warningText,
  },
  rowBusy: {
    opacity: 0.55,
  },
  rankCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  starBtn: {
    minWidth: 32,
    minHeight: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fbfcfd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  starBtnOn: {
    borderColor: '#e0c36a',
    backgroundColor: colors.warningBg,
  },
  starBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.muted,
  },
  starBtnTextOn: {
    color: '#c9a227',
  },
  rankBadge: {
    minWidth: 28,
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
  },
  rankBadgePinned: {
    color: '#7a5b00',
  },
  moveCol: {
    gap: 3,
  },
  moveBtn: {
    minWidth: 32,
    minHeight: 28,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: '#fbfcfd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveDisabled: {
    opacity: 0.35,
  },
  moveBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  playerCell: {
    flex: 1,
    minWidth: 100,
    gap: 2,
  },
  playerCellStacked: {
    minWidth: 0,
    width: '100%',
  },
  playerName: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  playerMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-end',
    flexShrink: 0,
  },
  actionsFill: {
    width: '100%',
    justifyContent: 'flex-start',
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  primaryBtnText: {
    color: colors.primaryText,
    fontWeight: '700',
    fontSize: 12,
  },
  phonePrimaryBtn: {
    flexGrow: 1,
    flexBasis: '30%',
    backgroundColor: colors.primary,
    borderRadius: layout.radius,
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  phonePrimaryBtnText: {
    color: colors.primaryText,
    fontWeight: '800',
    fontSize: 13,
  },
  ghostBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  ghostBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
  },
  phoneGhostBtn: {
    flexGrow: 1,
    flexBasis: '30%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.radius,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  phoneGhostBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  removeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  removeBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.danger,
  },
  tightGhostBtn: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  tightGhostBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
  },
  tightRemoveBtn: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: colors.dangerBg,
  },
  tightRemoveBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.danger,
  },
  phoneRemoveBtn: {
    flexGrow: 1,
    flexBasis: '30%',
    borderRadius: layout.radius,
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.dangerBg,
  },
  phoneRemoveBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.danger,
  },
  disabled: {
    opacity: 0.5,
  },
  teamsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  teamsRowThree: {
    flexWrap: 'nowrap',
    alignItems: 'stretch',
  },
});
