import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  getStartersAndSubs,
  listDepthChartEntries,
  moveDepthChartEntry,
  setDepthStarter,
  syncDepthChartPositionGroups,
  syncDepthChartTeam,
  type DepthChartEntry,
} from '@/lib/depthChart';
import {
  deletePlayer,
  listPlayers,
  patchPlayer,
  setPlayerPositions,
  setPlayerSquadTeam,
  setPlayerTeamRanks,
  subscribeToLiveMasterRoster,
  subscribeToPlayers,
  unsubscribePlayers,
  updatePlayer,
} from '@/lib/players';
import { useForegroundRefresh } from '@/lib/useForegroundRefresh';
import {
  moveAvailableInFilter,
  moveAvailableToBottom,
  moveAvailableToTop,
  planAvailableRanks,
  ranksNeedSync,
  resetAvailableDefaultOrder,
  toggleAvailablePin,
  type AvailableRankPlan,
  type GradeFilter,
} from '@/lib/availableRank';
import {
  formatPositionsShort,
  getDepthCanonicalPosition,
  normalizePositions,
  playerInDepthGroup,
} from '@/lib/positions';
import { getRoster } from '@/lib/rosters';
import {
  membershipKey,
  optimisticApplyStarterSwap,
  optimisticPatchPositions,
  type DepthCacheMap,
  type SquadDepthCache,
} from '@/lib/squadSections';
import {
  buildSwappedSubOrder,
  moveSubOrderEntry,
  orderPlayersBySubOrder,
  replaceSubOrder,
  syncSubOrder,
  type SubOrderEntry,
} from '@/lib/subOrder';
import {
  playersInRankPool,
  type RankPool,
} from '@/lib/assignPools';
import {
  adminLiveAssign,
  adminLiveRemoveFromTeam,
  adminLiveSetPoolRanks,
  fetchLiveMasterState,
  flattenLivePlayers,
  liveSquadPlayersForTeam,
  masterWorkspaceForSquad,
  type LiveMasterState,
} from '@/lib/adminLiveRoster';
import { useActiveRole } from '@/lib/ActiveRoleContext';
import { useMasterConflicts } from '@/lib/MasterConflictContext';
import {
  masterKindForSquad,
  masterWorkspaces,
} from '@/lib/masterConflicts';
import {
  isAllowedMasterAssignment,
  ownSquadForWorkspace,
} from '@/lib/masterWorkspace';
import { useOffline } from '@/lib/offline/OfflineContext';
import { loadRosterSnapshot, saveRosterSnapshot } from '@/lib/offline/snapshot';
import type { OfflineOp, OfflineOpInput } from '@/lib/offline/types';
import type {
  Player,
  PlayerAssignment,
  PlayerInput,
  Roster,
  SquadTeam,
  Workspace,
} from '@/lib/types';
import { isSquadTeam, SQUAD_TEAMS } from '@/lib/types';

type RosterDataValue = {
  rosterId: string;
  roster: Roster | null;
  players: Player[];
  depthCache: DepthCacheMap;
  loading: boolean;
  depthReady: boolean;
  error: string | null;
  clearError: () => void;
  savePlayer: (playerId: string, input: PlayerInput) => Promise<Player>;
  removePlayer: (player: Player) => Promise<void>;
  assignSquad: (
    playerId: string,
    team: PlayerAssignment | null
  ) => Promise<void>;
  changePositions: (playerId: string, positions: number[]) => Promise<void>;
  moveDepth: (params: {
    squadTeam: SquadTeam;
    positionNumber: number;
    playerId: string;
    direction: 'up' | 'down';
  }) => Promise<DepthChartEntry[]>;
  setStarter: (params: {
    squadTeam: SquadTeam;
    positionNumber: number;
    slotIndex: number;
    /** Incoming player who becomes the starter. */
    playerId: string;
    /** Current starter in the slot (stays on this team as a sub). */
    outgoingPlayerId?: string | null;
    /**
     * If incoming was a sub on this team, their 0-based bench index.
     * Outgoing takes that exact #12+ slot.
     */
    incomingSubIndex?: number | null;
  }) => Promise<DepthChartEntry[]>;
  moveSub: (params: {
    squadTeam: SquadTeam;
    playerId: string;
    direction: 'up' | 'down';
  }) => Promise<SubOrderEntry[]>;
  /** Seed / repair Available + Unavailable team_rank. */
  ensureAvailableRanks: () => Promise<void>;
  /** Reorder within Available or Unavailable (optional grade filter). */
  moveAvailable: (params: {
    playerId: string;
    direction: 'up' | 'down';
    grade?: GradeFilter;
    pool?: RankPool;
  }) => Promise<void>;
  toggleAvailablePin: (params: {
    playerId: string;
    grade?: GradeFilter;
    pool?: RankPool;
  }) => Promise<void>;
  moveAvailableToTop: (params: {
    playerId: string;
    grade?: GradeFilter;
    pool?: RankPool;
  }) => Promise<void>;
  moveAvailableToBottom: (params: {
    playerId: string;
    grade?: GradeFilter;
    pool?: RankPool;
  }) => Promise<void>;
  /** Reset unpinned players in a ranked pool to class then name. */
  resetAvailableOrder: (pool?: RankPool) => Promise<void>;
  /** Admin Live: remove from one master team (conflicts may remain). */
  removeFromLiveTeam: (playerId: string, squadTeam: SquadTeam) => Promise<void>;
};

const RosterDataContext = createContext<RosterDataValue | null>(null);

async function syncAndLoadSquad(
  rosterId: string,
  squadTeam: SquadTeam,
  workspaceId: string,
  squadPlayers: Player[]
): Promise<SquadDepthCache> {
  const depthEntries = await syncDepthChartTeam({
    rosterId,
    squadTeam,
    workspaceId,
    squadPlayers,
  });
  const split = getStartersAndSubs(squadPlayers, depthEntries);
  const subEntries = await syncSubOrder({
    rosterId,
    squadTeam,
    workspaceId,
    subPlayers: split.subs,
  });
  return { depthEntries, subEntries };
}

async function syncAffectedPositions(
  rosterId: string,
  squadTeam: SquadTeam,
  workspaceId: string,
  squadPlayers: Player[],
  positionNumbers: number[]
): Promise<SquadDepthCache> {
  const depthEntries = await syncDepthChartPositionGroups({
    rosterId,
    squadTeam,
    workspaceId,
    squadPlayers,
    positionNumbers,
  });
  const split = getStartersAndSubs(squadPlayers, depthEntries);
  const subEntries = await syncSubOrder({
    rosterId,
    squadTeam,
    workspaceId,
    subPlayers: split.subs,
  });
  return { depthEntries, subEntries };
}

export function RosterDataProvider({
  rosterId,
  children,
}: {
  rosterId: string;
  children: ReactNode;
}) {
  const {
    activeWorkspaceId,
    workspaceKind,
    loading: roleLoading,
    isAdminLiveMode,
    workspaces,
    adminEditMode,
  } = useActiveRole();
  const {
    refresh: refreshMasterClaims,
    exportSnapshotSlice,
    hydrateFromSnapshot,
    applyOfflineAssign,
    applyOfflineRemoveFromTeam,
  } = useMasterConflicts();
  const {
    isOnline,
    shouldQueueWrites,
    scope,
    enqueue,
    registerReplay,
    registerDrainComplete,
    setOfflineReady,
    retrySync,
  } = useOffline();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [depthCache, setDepthCache] = useState<DepthCacheMap>({});
  const [loading, setLoading] = useState(true);
  const [depthReady, setDepthReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const membershipRef = useRef('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncingRef = useRef(false);
  const muteRealtimeUntilRef = useRef(0);
  const rosterIdRef = useRef(rosterId);
  rosterIdRef.current = rosterId;
  const workspaceIdRef = useRef(activeWorkspaceId);
  workspaceIdRef.current = activeWorkspaceId;
  const workspaceKindRef = useRef(workspaceKind);
  workspaceKindRef.current = workspaceKind;
  const liveModeRef = useRef(isAdminLiveMode);
  liveModeRef.current = isAdminLiveMode;
  const mastersRef = useRef<Workspace[]>([]);
  mastersRef.current = masterWorkspaces(workspaces);
  const depthCacheRef = useRef(depthCache);
  depthCacheRef.current = depthCache;
  const playersRef = useRef(players);
  playersRef.current = players;
  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  /** Monotonic token so stale background starter writes can't overwrite newer swaps. */
  const starterSwapGenRef = useRef(0);
  const replayingRef = useRef(false);
  const shouldQueueRef = useRef(shouldQueueWrites);
  shouldQueueRef.current = shouldQueueWrites;
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;
  const refreshMasterClaimsRef = useRef(refreshMasterClaims);
  refreshMasterClaimsRef.current = refreshMasterClaims;

  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const exportSnapshotSliceRef = useRef(exportSnapshotSlice);
  exportSnapshotSliceRef.current = exportSnapshotSlice;
  const setOfflineReadyRef = useRef(setOfflineReady);
  setOfflineReadyRef.current = setOfflineReady;
  const hydrateFromSnapshotRef = useRef(hydrateFromSnapshot);
  hydrateFromSnapshotRef.current = hydrateFromSnapshot;

  const persistSnapshot = useCallback(async () => {
    const s = scopeRef.current;
    if (!s) return;
    if (playersRef.current.length === 0 && !rosterRef.current) return;
    const slice = exportSnapshotSliceRef.current();
    await saveRosterSnapshot({
      version: 1,
      scope: s,
      savedAt: Date.now(),
      roster: rosterRef.current,
      players: playersRef.current,
      depthCache: depthCacheRef.current,
      claimsEntries: slice.claimsEntries,
      claimedPlayers: slice.claimedPlayers,
      depthByKind: slice.depthByKind,
    });
    setOfflineReadyRef.current(true);
  }, []);

  const queueIfNeeded = useCallback(
    async (op: OfflineOpInput) => {
      if (replayingRef.current) return false;
      // Prefer live connectivity ref — shouldQueue can lag one render behind.
      const mustQueue =
        !isOnlineRef.current || shouldQueueRef.current;
      if (!mustQueue) return false;
      await enqueue(op);
      await persistSnapshot();
      return true;
    },
    [enqueue, persistSnapshot]
  );

  function workspaceIdForSquad(squad: SquadTeam): string | null {
    if (liveModeRef.current) {
      return masterWorkspaceForSquad(mastersRef.current, squad)?.id ?? null;
    }
    return workspaceIdRef.current;
  }

  function muteRealtimeBriefly(ms = 1200) {
    muteRealtimeUntilRef.current = Date.now() + ms;
  }

  const clearError = useCallback(() => setError(null), []);

  const syncDepthForPlayers = useCallback(async (nextPlayers: Player[]) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const id = rosterIdRef.current;
    try {
      // Live mode: same depth/sub sync as head coaches, for all three masters.
      // Read-only load left sub_order empty → ↑↓ bench ranking was a no-op.
      if (liveModeRef.current) {
        const masters = mastersRef.current;
        const live = await fetchLiveMasterState(masters);
        const liveState: LiveMasterState = { ...live, masters };
        const nextCache: DepthCacheMap = {};
        await Promise.all(
          SQUAD_TEAMS.map(async (team) => {
            const master = masterWorkspaceForSquad(masters, team.id);
            const squadPlayers = liveSquadPlayersForTeam(
              nextPlayers,
              team.id,
              liveState
            );
            if (!master || squadPlayers.length === 0) {
              nextCache[team.id] = { depthEntries: [], subEntries: [] };
              return;
            }
            nextCache[team.id] = await syncAndLoadSquad(
              id,
              team.id,
              master.id,
              squadPlayers
            );
          })
        );
        setDepthCache(nextCache);
        membershipRef.current = membershipKey(nextPlayers);
        setDepthReady(true);
        return;
      }

      const nextCache: DepthCacheMap = {};
      const kind = workspaceKindRef.current;
      const ownSquad = ownSquadForWorkspace(kind);
      const teamsToSync =
        ownSquad != null
          ? SQUAD_TEAMS.filter((t) => t.id === ownSquad)
          : SQUAD_TEAMS;

      for (const team of SQUAD_TEAMS) {
        if (!teamsToSync.some((t) => t.id === team.id)) {
          nextCache[team.id] = { depthEntries: [], subEntries: [] };
          continue;
        }
        const squadPlayers = nextPlayers.filter((p) => p.squad_team === team.id);
        if (squadPlayers.length === 0) {
          nextCache[team.id] = { depthEntries: [], subEntries: [] };
          continue;
        }
        const workspaceId = workspaceIdRef.current;
        if (!workspaceId) {
          nextCache[team.id] = { depthEntries: [], subEntries: [] };
          continue;
        }
        nextCache[team.id] = await syncAndLoadSquad(
          id,
          team.id,
          workspaceId,
          squadPlayers
        );
      }
      setDepthCache(nextCache);
      membershipRef.current = membershipKey(nextPlayers);
      setDepthReady(true);
    } finally {
      syncingRef.current = false;
    }
  }, []);

  const refreshSquadCache = useCallback(
    async (squadTeam: SquadTeam, squadPlayers: Player[]) => {
      const id = rosterIdRef.current;
      const workspaceId = workspaceIdForSquad(squadTeam);
      if (!workspaceId) {
        setDepthCache((prev) => ({
          ...prev,
          [squadTeam]: { depthEntries: [], subEntries: [] },
        }));
        return;
      }
      const depthEntries = await listDepthChartEntries(
        id,
        squadTeam,
        workspaceId
      );
      const split = getStartersAndSubs(squadPlayers, depthEntries);
      const subEntries = await syncSubOrder({
        rosterId: id,
        squadTeam,
        workspaceId,
        subPlayers: split.subs,
      });
      setDepthCache((prev) => ({
        ...prev,
        [squadTeam]: { depthEntries, subEntries },
      }));
    },
    []
  );

  const applyPlayers = useCallback(
    async (
      nextPlayers: Player[],
      opts?: { forceSync?: boolean; skipDepthSync?: boolean }
    ) => {
      setPlayers(nextPlayers);
      playersRef.current = nextPlayers;
      if (opts?.skipDepthSync) {
        membershipRef.current = membershipKey(nextPlayers);
        return;
      }
      const nextKey = membershipKey(nextPlayers);
      if (opts?.forceSync || nextKey !== membershipRef.current) {
        await syncDepthForPlayers(nextPlayers);
      }
    },
    [syncDepthForPlayers]
  );

  const refreshLivePlayers = useCallback(
    async (opts?: { forceSync?: boolean; skipDepthSync?: boolean }) => {
      const workspaceId = workspaceIdRef.current;
      if (!workspaceId) return;
      const id = rosterIdRef.current;
      const [base, live] = await Promise.all([
        listPlayers(id, workspaceId),
        fetchLiveMasterState(mastersRef.current),
      ]);
      const data = flattenLivePlayers(base, {
        ...live,
        masters: mastersRef.current,
      });
      await applyPlayers(data, opts);
    },
    [applyPlayers]
  );

  const refreshPlayers = useCallback(
    async (opts?: { forceSync?: boolean }) => {
      if (liveModeRef.current) {
        await refreshLivePlayers(opts);
        return;
      }
      const workspaceId = workspaceIdRef.current;
      if (!workspaceId) return;
      const data = await listPlayers(rosterIdRef.current, workspaceId);
      await applyPlayers(data, opts);
    },
    [applyPlayers, refreshLivePlayers]
  );

  const refreshPlayersRef = useRef(refreshPlayers);
  refreshPlayersRef.current = refreshPlayers;

  async function hydrateFromSnap(scopeToLoad: NonNullable<typeof scope>) {
    const snap = await loadRosterSnapshot(scopeToLoad);
    if (!snap) return false;
    setRoster(snap.roster);
    rosterRef.current = snap.roster;
    setPlayers(snap.players);
    playersRef.current = snap.players;
    setDepthCache(snap.depthCache);
    depthCacheRef.current = snap.depthCache;
    membershipRef.current = membershipKey(snap.players);
    setDepthReady(true);
    hydrateFromSnapshotRef.current({
      claimsEntries: snap.claimsEntries,
      claimedPlayers: snap.claimedPlayers,
      depthByKind: snap.depthByKind,
    });
    setOfflineReadyRef.current(true);
    setError(null);
    return true;
  }

  // Initial / workspace load only — do NOT depend on isOnline (airplane mode
  // must not wipe in-memory roster and thrash the UI).
  useEffect(() => {
    let active = true;
    membershipRef.current = '';
    setDepthCache({});
    setDepthReady(false);

    if (roleLoading) {
      setLoading(true);
      return () => {
        active = false;
      };
    }

    if (!activeWorkspaceId || !scope) {
      setLoading(false);
      setPlayers([]);
      setError(
        activeWorkspaceId ? null : 'No active workspace for this role.'
      );
      return () => {
        active = false;
      };
    }

    const workspaceId = activeWorkspaceId;
    const live = isAdminLiveMode;
    const loadScope = scope;

    (async () => {
      setLoading(true);
      setError(null);

      // Cold start while offline: restore snapshot. Online path preferred.
      if (!isOnlineRef.current) {
        const ok = await hydrateFromSnap(loadScope);
        if (!ok && active) {
          setError('Connect once online to use this roster offline.');
          setOfflineReadyRef.current(false);
        }
        if (active) setLoading(false);
        return;
      }

      try {
        const r = await getRoster(rosterId);
        if (!active) return;
        if (!r) {
          setError('Roster not found');
          setRoster(null);
          setPlayers([]);
          return;
        }
        setRoster(r);
        rosterRef.current = r;
        if (live) {
          const [base, liveState] = await Promise.all([
            listPlayers(rosterId, workspaceId),
            fetchLiveMasterState(masterWorkspaces(workspaces)),
          ]);
          if (!active) return;
          const data = flattenLivePlayers(base, {
            ...liveState,
            masters: masterWorkspaces(workspaces),
          });
          setPlayers(data);
          playersRef.current = data;
          await syncDepthForPlayers(data);
        } else {
          const data = await listPlayers(rosterId, workspaceId);
          if (!active) return;
          setPlayers(data);
          playersRef.current = data;
          await syncDepthForPlayers(data);
        }
        if (active) await persistSnapshot();
      } catch (e) {
        const ok = await hydrateFromSnap(loadScope);
        if (!ok && active) {
          setError(e instanceof Error ? e.message : 'Failed to load roster');
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [
    rosterId,
    activeWorkspaceId,
    roleLoading,
    isAdminLiveMode,
    workspaces,
    syncDepthForPlayers,
    // scope identity via workspace + mode (not the object itself)
    adminEditMode,
    persistSnapshot,
  ]);

  // Connectivity transitions: keep memory on offline. Do NOT soft-refresh from
  // the server before the outbox drains — that raced sync and dropped writes.
  useEffect(() => {
    if (roleLoading || !scope) return;

    if (!isOnline) {
      if (playersRef.current.length > 0 || rosterRef.current) {
        setError(null);
        setOfflineReadyRef.current(true);
        void persistSnapshot();
        return;
      }
      void (async () => {
        const ok = await hydrateFromSnap(scope);
        if (!ok) {
          setError('Connect once online to use this roster offline.');
          setOfflineReadyRef.current(false);
        }
      })();
      return;
    }

    // Back online: kick outbox drain (refresh happens in drainComplete).
    setError(null);
    retrySync();
  }, [isOnline, roleLoading, scope, persistSnapshot, retrySync]);

  const pullRemote = useCallback(() => {
    if (!isOnlineRef.current) return;
    if (Date.now() < muteRealtimeUntilRef.current) return;
    void refreshMasterClaimsRef.current().catch(() => {
      // Claims can lag; players refresh still helps.
    });
    void refreshPlayersRef.current({ forceSync: true }).catch((e) => {
      setError(e instanceof Error ? e.message : 'Failed to refresh players');
    });
  }, []);

  // Catch missed realtime (idle desktop tabs) via focus + light polling.
  useForegroundRefresh(
    Boolean(isOnline && !roleLoading && activeWorkspaceId),
    pullRemote,
    12_000
  );

  // Realtime only while online.
  const [realtimeEpoch, setRealtimeEpoch] = useState(0);
  useEffect(() => {
    if (roleLoading || !isOnline || !activeWorkspaceId) return;

    const onRealtime = () => {
      if (!isOnlineRef.current) return;
      if (Date.now() < muteRealtimeUntilRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        pullRemote();
      }, 300);
    };

    const onStatus = (status: string) => {
      // Do not resubscribe on CLOSED — that fires on intentional teardown too.
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setRealtimeEpoch((n) => n + 1);
      }
    };

    const live = isAdminLiveMode;
    const masterIds = masterWorkspaces(workspaces).map((w) => w.id);
    const channel =
      live && masterIds.length > 0
        ? subscribeToLiveMasterRoster(
            rosterId,
            masterIds,
            onRealtime,
            onStatus
          )
        : subscribeToPlayers(
            rosterId,
            activeWorkspaceId,
            onRealtime,
            onStatus
          );

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void unsubscribePlayers(channel);
    };
  }, [
    rosterId,
    activeWorkspaceId,
    roleLoading,
    isAdminLiveMode,
    isOnline,
    workspaces,
    realtimeEpoch,
    pullRemote,
  ]);

  const savePlayer = useCallback(
    async (playerId: string, input: PlayerInput) => {
      const prev = playersRef.current.find((p) => p.id === playerId);
      const workspaceId = workspaceIdRef.current;
      if (!workspaceId) throw new Error('No active workspace');

      if (await queueIfNeeded({ type: 'savePlayer', playerId, input })) {
        const nextPositions = normalizePositions(input.positions);
        const updated: Player = {
          ...(prev as Player),
          first_name: input.first_name,
          last_name: input.last_name,
          school_year: input.school_year,
          positions: nextPositions,
          position: formatPositionsShort(nextPositions),
        };
        const next = playersRef.current.map((p) =>
          p.id === playerId ? updated : p
        );
        setPlayers(next);
        playersRef.current = next;
        return updated;
      }

      const updated = await updatePlayer(playerId, input, workspaceId);
      const next = playersRef.current.map((p) =>
        p.id === playerId ? updated : p
      );
      setPlayers(next);
      playersRef.current = next;
      muteRealtimeBriefly();
      membershipRef.current = membershipKey(next);

      const prevPositions = normalizePositions(prev?.positions);
      const nextPositions = normalizePositions(updated.positions);
      const positionsChanged =
        prevPositions.join(',') !== nextPositions.join(',');

      if (positionsChanged && isSquadTeam(updated.squad_team)) {
        const squadTeam = updated.squad_team;
        const squadPlayers = next.filter((p) => p.squad_team === squadTeam);

        // Instant UI: patch cache before waiting on the network
        const optimistic = optimisticPatchPositions({
          cache: depthCacheRef.current[squadTeam],
          squadPlayers,
          player: updated,
          prevPositions,
          nextPositions,
        });
        setDepthCache((prevCache) => ({
          ...prevCache,
          [squadTeam]: optimistic,
        }));

        // Narrow background sync for only changed position groups
        const affected = [...new Set([...prevPositions, ...nextPositions])];
        void syncAffectedPositions(
          rosterId,
          squadTeam,
          workspaceId,
          squadPlayers,
          affected
        )
          .then((cache) => {
            setDepthCache((prevCache) => ({
              ...prevCache,
              [squadTeam]: cache,
            }));
          })
          .catch((e) => {
            setError(
              e instanceof Error ? e.message : 'Failed to sync depth chart'
            );
          });
      }

      void persistSnapshot();
      return updated;
    },
    [rosterId, queueIfNeeded, persistSnapshot]
  );

  const removePlayer = useCallback(
    async (player: Player) => {
      if (await queueIfNeeded({ type: 'removePlayer', playerId: player.id })) {
        const next = playersRef.current.filter((p) => p.id !== player.id);
        setPlayers(next);
        playersRef.current = next;
        membershipRef.current = membershipKey(next);
        return;
      }

      await deletePlayer(player.id);
      const next = playersRef.current.filter((p) => p.id !== player.id);
      setPlayers(next);
      playersRef.current = next;
      if (isSquadTeam(player.squad_team)) {
        const squadTeam = player.squad_team;
        const squadPlayers = next.filter((p) => p.squad_team === squadTeam);
        if (squadPlayers.length === 0) {
          setDepthCache((prev) => ({
            ...prev,
            [squadTeam]: { depthEntries: [], subEntries: [] },
          }));
        } else {
          const workspaceId = workspaceIdForSquad(squadTeam);
          if (!workspaceId) return;
          const cache = await syncAndLoadSquad(
            rosterId,
            squadTeam,
            workspaceId,
            squadPlayers
          );
          setDepthCache((prev) => ({ ...prev, [squadTeam]: cache }));
        }
        membershipRef.current = membershipKey(next);
      }
      void persistSnapshot();
    },
    [rosterId, queueIfNeeded, persistSnapshot]
  );

  const assignSquad = useCallback(
    async (playerId: string, team: PlayerAssignment | null) => {
      const prev = playersRef.current.find((p) => p.id === playerId);
      const workspaceId = workspaceIdRef.current;
      if (!workspaceId) throw new Error('No active workspace');

      if (await queueIfNeeded({ type: 'assignSquad', playerId, team })) {
        const next = playersRef.current.map((p) =>
          p.id === playerId
            ? { ...p, squad_team: team, available_pinned: false }
            : p
        );
        setPlayers(next);
        playersRef.current = next;
        membershipRef.current = membershipKey(next);
        if (liveModeRef.current) {
          applyOfflineAssign(playerId, team, prev ?? null);
        }
        return;
      }

      if (liveModeRef.current) {
        const live = await fetchLiveMasterState(mastersRef.current);
        await adminLiveAssign({
          rosterId,
          masters: mastersRef.current,
          playerId,
          target: team,
          players: playersRef.current,
          claimsByPlayer: live.claimsByPlayer,
        });
        muteRealtimeBriefly(4000);
        // Claims drive Assign / All Players team columns — refresh before UI reads.
        await refreshMasterClaims();
        await refreshLivePlayers({ forceSync: true });
        void persistSnapshot();
        return;
      }

      if (!isAllowedMasterAssignment(workspaceKindRef.current, team)) {
        throw new Error(
          'This master can only assign to its own team, Available, or Unavailable.'
        );
      }
      // Changing pools/teams clears the star pin.
      const updated =
        prev?.available_pinned && prev.squad_team !== team
          ? await patchPlayer(
              playerId,
              {
                squad_team: team,
                available_pinned: false,
              },
              workspaceId
            )
          : await setPlayerSquadTeam(playerId, team, workspaceId);
      let next = playersRef.current.map((p) =>
        p.id === playerId ? updated : p
      );
      setPlayers(next);
      playersRef.current = next;
      muteRealtimeBriefly();
      membershipRef.current = membershipKey(next);

      const touched = new Set<SquadTeam>();
      if (isSquadTeam(prev?.squad_team)) touched.add(prev.squad_team);
      if (isSquadTeam(updated.squad_team)) touched.add(updated.squad_team);

      const patch: DepthCacheMap = {};
      await Promise.all(
        [...touched].map(async (squad) => {
          const squadPlayers = next.filter((p) => p.squad_team === squad);
          patch[squad] =
            squadPlayers.length === 0
              ? { depthEntries: [], subEntries: [] }
              : await syncAndLoadSquad(
                  rosterId,
                  squad,
                  workspaceId,
                  squadPlayers
                );
        })
      );
      setDepthCache((prevCache) => ({ ...prevCache, ...patch }));

      // Keep Available / Unavailable team_rank contiguous after pool moves
      // (Assign, All Players SquadSelect, Depth, etc.).
      const pools: RankPool[] = ['available', 'unavailable'];
      for (const pool of pools) {
        const list = playersInRankPool(next, pool);
        if (list.length === 0) continue;
        const planned = planAvailableRanks(list);
        if (!ranksNeedSync(list, planned)) continue;
        const byId = new Map(planned.map((r) => [r.playerId, r]));
        next = next.map((p) => {
          const row = byId.get(p.id);
          if (!row) return p;
          return {
            ...p,
            team_rank: row.team_rank,
            available_pinned: row.available_pinned,
          };
        });
        setPlayers(next);
        playersRef.current = next;
        muteRealtimeBriefly(4000);
        await setPlayerTeamRanks(planned, workspaceId);
      }
      void persistSnapshot();
    },
    [
      rosterId,
      refreshLivePlayers,
      refreshMasterClaims,
      queueIfNeeded,
      persistSnapshot,
      applyOfflineAssign,
    ]
  );

  const changePositions = useCallback(
    async (playerId: string, positions: number[]) => {
      const prev = playersRef.current.find((p) => p.id === playerId);
      const workspaceId = workspaceIdRef.current;
      if (!workspaceId) throw new Error('No active workspace');

      if (await queueIfNeeded({ type: 'changePositions', playerId, positions })) {
        const nextPositions = normalizePositions(positions);
        const next = playersRef.current.map((p) =>
          p.id === playerId
            ? {
                ...p,
                positions: nextPositions,
                position: formatPositionsShort(nextPositions),
              }
            : p
        );
        setPlayers(next);
        playersRef.current = next;
        return;
      }

      const updated = await setPlayerPositions(
        playerId,
        positions,
        workspaceId
      );
      const next = playersRef.current.map((p) =>
        p.id === playerId ? updated : p
      );
      setPlayers(next);
      playersRef.current = next;
      muteRealtimeBriefly();
      membershipRef.current = membershipKey(next);

      if (isSquadTeam(updated.squad_team)) {
        const squadTeam = updated.squad_team;
        const squadPlayers = next.filter((p) => p.squad_team === squadTeam);
        const prevPositions = normalizePositions(prev?.positions);
        const nextPositions = normalizePositions(updated.positions);
        const depthWorkspaceId = workspaceIdForSquad(squadTeam) ?? workspaceId;

        setDepthCache((prevCache) => ({
          ...prevCache,
          [squadTeam]: optimisticPatchPositions({
            cache: prevCache[squadTeam],
            squadPlayers,
            player: updated,
            prevPositions,
            nextPositions,
          }),
        }));

        const affected = [...new Set([...prevPositions, ...nextPositions])];
        void syncAffectedPositions(
          rosterId,
          squadTeam,
          depthWorkspaceId,
          squadPlayers,
          affected
        )
          .then((cache) => {
            setDepthCache((prevCache) => ({
              ...prevCache,
              [squadTeam]: cache,
            }));
          })
          .catch((e) => {
            setError(
              e instanceof Error ? e.message : 'Failed to sync depth chart'
            );
          });
      }
      void persistSnapshot();
    },
    [rosterId, queueIfNeeded, persistSnapshot]
  );

  const moveDepth = useCallback(
    async (params: {
      squadTeam: SquadTeam;
      positionNumber: number;
      playerId: string;
      direction: 'up' | 'down';
    }) => {
      if (await queueIfNeeded({ type: 'moveDepth', ...params })) {
        const cache = depthCacheRef.current[params.squadTeam];
        const canonical = getDepthCanonicalPosition(params.positionNumber);
        const entries = [...(cache?.depthEntries ?? [])];
        const atPos = entries
          .filter((e) => e.position_number === canonical)
          .sort((a, b) => a.sort_order - b.sort_order);
        const idx = atPos.findIndex((e) => e.player_id === params.playerId);
        const swapWith =
          params.direction === 'up' ? idx - 1 : idx + 1;
        if (idx >= 0 && swapWith >= 0 && swapWith < atPos.length) {
          const a = atPos[idx];
          const b = atPos[swapWith];
          const nextEntries = entries.map((e) => {
            if (e.id === a.id) return { ...e, sort_order: b.sort_order };
            if (e.id === b.id) return { ...e, sort_order: a.sort_order };
            return e;
          });
          setDepthCache((prev) => ({
            ...prev,
            [params.squadTeam]: {
              depthEntries: nextEntries,
              subEntries: prev[params.squadTeam]?.subEntries ?? [],
            },
          }));
          return nextEntries;
        }
        return entries;
      }

      const workspaceId = workspaceIdForSquad(params.squadTeam);
      if (!workspaceId) throw new Error('No active workspace');
      const entries = await moveDepthChartEntry({
        rosterId,
        squadTeam: params.squadTeam,
        workspaceId,
        positionNumber: params.positionNumber,
        playerId: params.playerId,
        direction: params.direction,
      });
      let squadPlayers = playersRef.current.filter(
        (p) => p.squad_team === params.squadTeam
      );
      if (liveModeRef.current) {
        const live = await fetchLiveMasterState(mastersRef.current);
        squadPlayers = liveSquadPlayersForTeam(playersRef.current, params.squadTeam, {
          ...live,
          masters: mastersRef.current,
        });
      }
      await refreshSquadCache(params.squadTeam, squadPlayers);
      void persistSnapshot();
      return entries;
    },
    [rosterId, refreshSquadCache, queueIfNeeded, persistSnapshot]
  );

  const setStarter = useCallback(
    async (params: {
      squadTeam: SquadTeam;
      positionNumber: number;
      slotIndex: number;
      playerId: string;
      outgoingPlayerId?: string | null;
      incomingSubIndex?: number | null;
    }) => {
      const incomingId = params.playerId;
      const outgoingId =
        params.outgoingPlayerId && params.outgoingPlayerId !== incomingId
          ? params.outgoingPlayerId
          : null;

      const workingBase = playersRef.current;
      const player = workingBase.find((p) => p.id === incomingId);
      if (!player) {
        const message = 'Player not found.';
        setError(message);
        throw new Error(message);
      }

      if (
        !isAllowedMasterAssignment(
          workspaceKindRef.current,
          params.squadTeam
        )
      ) {
        const message =
          'This master can only set starters on its own team.';
        setError(message);
        throw new Error(message);
      }

      const prevTeam = player.squad_team;
      const canonical = getDepthCanonicalPosition(params.positionNumber);
      const needsPosition = !playerInDepthGroup(
        player.positions,
        params.positionNumber
      );
      const nextPositions = needsPosition
        ? [...new Set([...normalizePositions(player.positions), canonical])].sort(
            (a, b) => a - b
          )
        : normalizePositions(player.positions);

      // Live mode: official claims decide "already on team", not flattened squad_team.
      let liveNeedsAssign = false;
      let livePrevClaimedTeams: SquadTeam[] = [];
      let liveState: LiveMasterState | null = null;
      if (liveModeRef.current) {
        liveState = {
          ...(await fetchLiveMasterState(mastersRef.current)),
          masters: mastersRef.current,
        };
        const claims = liveState.claimsByPlayer.get(incomingId) ?? [];
        const targetKind = masterKindForSquad(params.squadTeam);
        liveNeedsAssign = !claims.some((c) => c.kind === targetKind);
        livePrevClaimedTeams = claims.map((c) => c.squadTeam);
      }
      const needsTeamMove = liveModeRef.current
        ? liveNeedsAssign
        : prevTeam !== params.squadTeam;

      const priorCache = depthCacheRef.current[params.squadTeam];
      const priorDepthCacheSnapshot = depthCacheRef.current;
      const priorSquadPlayers = liveState
        ? liveSquadPlayersForTeam(
            workingBase,
            params.squadTeam,
            liveState
          )
        : workingBase.filter((p) => p.squad_team === params.squadTeam);
      const priorSplit = getStartersAndSubs(
        priorSquadPlayers,
        priorCache?.depthEntries ?? []
      );
      const previousSubIds = orderPlayersBySubOrder(
        priorSplit.subs,
        priorCache?.subEntries ?? []
      ).map((p) => p.id);

      // Local player patches first so the formation can update immediately.
      let working = workingBase.map((p) => {
        if (p.id === incomingId) {
          return {
            ...p,
            squad_team: params.squadTeam,
            positions: nextPositions,
            position: formatPositionsShort(nextPositions),
          };
        }
        if (
          outgoingId &&
          p.id === outgoingId &&
          p.squad_team !== params.squadTeam
        ) {
          return { ...p, squad_team: params.squadTeam };
        }
        return p;
      });

      // Live: start from claim-based squad (duals), then apply optimistic patches.
      const patchedById = new Map(working.map((p) => [p.id, p]));
      const targetSquadPlayers = (
        liveState
          ? liveSquadPlayersForTeam(workingBase, params.squadTeam, liveState)
          : working.filter((p) => p.squad_team === params.squadTeam)
      ).map((p) => {
        const patched = patchedById.get(p.id);
        return patched
          ? { ...patched, squad_team: params.squadTeam }
          : { ...p, squad_team: params.squadTeam };
      });
      // Ensure incoming/outgoing are on the optimistic squad even if claims lag.
      if (!targetSquadPlayers.some((p) => p.id === incomingId)) {
        targetSquadPlayers.push({
          ...player,
          squad_team: params.squadTeam,
          positions: nextPositions,
          position: formatPositionsShort(nextPositions),
        });
      }
      if (
        outgoingId &&
        !targetSquadPlayers.some((p) => p.id === outgoingId)
      ) {
        const outgoing = patchedById.get(outgoingId);
        if (outgoing) {
          targetSquadPlayers.push({
            ...outgoing,
            squad_team: params.squadTeam,
          });
        }
      }
      const optimisticCache = optimisticApplyStarterSwap({
        rosterId,
        squadTeam: params.squadTeam,
        cache: priorCache,
        squadPlayers: targetSquadPlayers,
        positionNumber: params.positionNumber,
        slotIndex: params.slotIndex,
        incomingPlayerId: incomingId,
        outgoingPlayerId: outgoingId,
        previousSubIds,
        incomingSubIndex: params.incomingSubIndex ?? null,
      });

      const swapGen = ++starterSwapGenRef.current;

      setError(null);
      setPlayers(working);
      playersRef.current = working;
      setDepthCache((prev) => ({
        ...prev,
        [params.squadTeam]: optimisticCache,
      }));
      muteRealtimeBriefly(10000);
      membershipRef.current = membershipKey(working);

      const desiredSubIds = buildSwappedSubOrder({
        previousSubIds,
        incomingPlayerId: incomingId,
        outgoingPlayerId: outgoingId,
        incomingSubIndex: params.incomingSubIndex ?? null,
      });

      const persist = async () => {
        const workspaceId = workspaceIdForSquad(params.squadTeam);
        if (!workspaceId) throw new Error('No active workspace');

        if (liveModeRef.current) {
          // Already on this master → only touch depth/positions (keep other claims).
          // Not on this master → assign to T (clears other masters; no new duals).
          if (liveNeedsAssign) {
            const live = await fetchLiveMasterState(mastersRef.current);
            await adminLiveAssign({
              rosterId,
              masters: mastersRef.current,
              playerId: incomingId,
              target: params.squadTeam,
              players: playersRef.current,
              claimsByPlayer: live.claimsByPlayer,
            });
            await refreshMasterClaims();
          }
          if (needsPosition) {
            await setPlayerPositions(incomingId, nextPositions, workspaceId);
            working = playersRef.current.map((p) =>
              p.id === incomingId
                ? {
                    ...p,
                    positions: nextPositions,
                    position: formatPositionsShort(nextPositions),
                    squad_team: params.squadTeam,
                  }
                : p
            );
            setPlayers(working);
            playersRef.current = working;
          }

          if (outgoingId) {
            const live = await fetchLiveMasterState(mastersRef.current);
            const outClaims = live.claimsByPlayer.get(outgoingId) ?? [];
            const onTarget = outClaims.some(
              (c) => c.kind === masterKindForSquad(params.squadTeam)
            );
            if (!onTarget) {
              await adminLiveAssign({
                rosterId,
                masters: mastersRef.current,
                playerId: outgoingId,
                target: params.squadTeam,
                players: playersRef.current,
                claimsByPlayer: live.claimsByPlayer,
              });
              await refreshMasterClaims();
            }
          }

          if (swapGen !== starterSwapGenRef.current) return;

          // Write starter BEFORE any depth reload (reload was wiping the swap).
          muteRealtimeBriefly(10000);
          const depthEntries = await setDepthStarter({
            rosterId,
            squadTeam: params.squadTeam,
            workspaceId,
            positionNumber: params.positionNumber,
            slotIndex: params.slotIndex,
            playerId: incomingId,
            outgoingPlayerId: outgoingId,
          });
          if (swapGen !== starterSwapGenRef.current) return;

          await refreshLivePlayers({ skipDepthSync: true });
          if (swapGen !== starterSwapGenRef.current) return;

          const liveAfter: LiveMasterState = {
            ...(await fetchLiveMasterState(mastersRef.current)),
            masters: mastersRef.current,
          };
          const squadPlayers = liveSquadPlayersForTeam(
            playersRef.current,
            params.squadTeam,
            liveAfter
          );
          const split = getStartersAndSubs(squadPlayers, depthEntries);
          const subIdSet = new Set(split.subs.map((p) => p.id));
          const orderedSubIds = [
            ...desiredSubIds.filter((id) => subIdSet.has(id)),
            ...split.subs
              .map((p) => p.id)
              .filter((id) => !desiredSubIds.includes(id)),
          ];
          const subEntries = await replaceSubOrder({
            rosterId,
            squadTeam: params.squadTeam,
            workspaceId,
            orderedPlayerIds: orderedSubIds,
          });
          if (swapGen !== starterSwapGenRef.current) return;

          setError(null);
          setDepthCache((prev) => ({
            ...prev,
            [params.squadTeam]: { depthEntries, subEntries },
          }));

          // Refresh depth for teams the player left (move case only).
          if (liveNeedsAssign) {
            for (const left of livePrevClaimedTeams) {
              if (left === params.squadTeam) continue;
              const leftWs = workspaceIdForSquad(left);
              const leftPlayers = liveSquadPlayersForTeam(
                playersRef.current,
                left,
                liveAfter
              );
              if (!leftWs || leftPlayers.length === 0) {
                setDepthCache((prev) => ({
                  ...prev,
                  [left]: { depthEntries: [], subEntries: [] },
                }));
              } else {
                const cache = await syncAndLoadSquad(
                  rosterId,
                  left,
                  leftWs,
                  leftPlayers
                );
                if (swapGen !== starterSwapGenRef.current) return;
                setDepthCache((prev) => ({ ...prev, [left]: cache }));
              }
            }
          }
          return;
        }

        // Personal / head-coach path (unchanged).
        if (needsTeamMove || needsPosition) {
          const updated = await patchPlayer(
            incomingId,
            {
              ...(needsTeamMove ? { squad_team: params.squadTeam } : {}),
              ...(needsPosition ? { positions: nextPositions } : {}),
            },
            workspaceId
          );
          if (swapGen !== starterSwapGenRef.current) return;
          working = playersRef.current.map((p) =>
            p.id === incomingId ? updated : p
          );
          setPlayers(working);
          playersRef.current = working;
        }

        if (outgoingId) {
          const outgoing = playersRef.current.find((p) => p.id === outgoingId);
          if (outgoing && outgoing.squad_team !== params.squadTeam) {
            const updated = await setPlayerSquadTeam(
              outgoingId,
              params.squadTeam,
              workspaceId
            );
            if (swapGen !== starterSwapGenRef.current) return;
            working = playersRef.current.map((p) =>
              p.id === outgoingId ? updated : p
            );
            setPlayers(working);
            playersRef.current = working;
          }
        }

        if (swapGen !== starterSwapGenRef.current) return;
        muteRealtimeBriefly(10000);

        const depthEntries = await setDepthStarter({
          rosterId,
          squadTeam: params.squadTeam,
          workspaceId,
          positionNumber: params.positionNumber,
          slotIndex: params.slotIndex,
          playerId: incomingId,
          outgoingPlayerId: outgoingId,
        });
        if (swapGen !== starterSwapGenRef.current) return;

        const squadPlayers = playersRef.current.filter(
          (p) => p.squad_team === params.squadTeam
        );
        const split = getStartersAndSubs(squadPlayers, depthEntries);
        const subIdSet = new Set(split.subs.map((p) => p.id));
        const orderedSubIds = [
          ...desiredSubIds.filter((id) => subIdSet.has(id)),
          ...split.subs
            .map((p) => p.id)
            .filter((id) => !desiredSubIds.includes(id)),
        ];
        const subEntries = await replaceSubOrder({
          rosterId,
          squadTeam: params.squadTeam,
          workspaceId,
          orderedPlayerIds: orderedSubIds,
        });
        if (swapGen !== starterSwapGenRef.current) return;

        setError(null);
        setDepthCache((prev) => ({
          ...prev,
          [params.squadTeam]: { depthEntries, subEntries },
        }));

        if (needsTeamMove && isSquadTeam(prevTeam)) {
          const prevPlayers = playersRef.current.filter(
            (p) => p.squad_team === prevTeam
          );
          const prevWorkspaceId = workspaceIdForSquad(prevTeam);
          if (prevPlayers.length === 0 || !prevWorkspaceId) {
            setDepthCache((prev) => ({
              ...prev,
              [prevTeam]: { depthEntries: [], subEntries: [] },
            }));
          } else {
            const cache = await syncAndLoadSquad(
              rosterId,
              prevTeam,
              prevWorkspaceId,
              prevPlayers
            );
            if (swapGen !== starterSwapGenRef.current) return;
            setDepthCache((prev) => ({ ...prev, [prevTeam]: cache }));
          }
        }
      };

      // Offline / outbox: keep optimistic UI and sync on reconnect.
      if (
        await queueIfNeeded({
          type: 'setStarter',
          squadTeam: params.squadTeam,
          positionNumber: params.positionNumber,
          slotIndex: params.slotIndex,
          playerId: incomingId,
          outgoingPlayerId: outgoingId,
          incomingSubIndex: params.incomingSubIndex ?? null,
        })
      ) {
        if (liveModeRef.current) {
          applyOfflineAssign(
            incomingId,
            params.squadTeam,
            playersRef.current.find((p) => p.id === incomingId) ?? null
          );
        }
        return optimisticCache.depthEntries;
      }

      // Live mode: await persist so UI/other tabs don't race a depth reload.
      if (liveModeRef.current) {
        try {
          await persist();
        } catch (e) {
          if (swapGen === starterSwapGenRef.current) {
            setPlayers(workingBase);
            playersRef.current = workingBase;
            setDepthCache(priorDepthCacheSnapshot);
            membershipRef.current = membershipKey(workingBase);
            muteRealtimeBriefly(500);
            setError(
              e instanceof Error ? e.message : 'Failed to update starter'
            );
          }
          throw e;
        }
        void persistSnapshot();
        return (
          depthCacheRef.current[params.squadTeam]?.depthEntries ??
          optimisticCache.depthEntries
        );
      }

      // Personal / coach: keep snappy background persist.
      void persist()
        .then(() => {
          void persistSnapshot();
        })
        .catch((e) => {
          if (swapGen !== starterSwapGenRef.current) return;
          setPlayers(workingBase);
          playersRef.current = workingBase;
          setDepthCache(priorDepthCacheSnapshot);
          membershipRef.current = membershipKey(workingBase);
          muteRealtimeBriefly(500);
          setError(e instanceof Error ? e.message : 'Failed to update starter');
        });

      return optimisticCache.depthEntries;
    },
    [
      rosterId,
      refreshLivePlayers,
      refreshMasterClaims,
      queueIfNeeded,
      persistSnapshot,
      applyOfflineAssign,
    ]
  );

  const moveSub = useCallback(
    async (params: {
      squadTeam: SquadTeam;
      playerId: string;
      direction: 'up' | 'down';
    }) => {
      if (await queueIfNeeded({ type: 'moveSub', ...params })) {
        const subs = [
          ...(depthCacheRef.current[params.squadTeam]?.subEntries ?? []),
        ].sort((a, b) => a.sort_order - b.sort_order);
        const idx = subs.findIndex((e) => e.player_id === params.playerId);
        const swapWith = params.direction === 'up' ? idx - 1 : idx + 1;
        if (idx >= 0 && swapWith >= 0 && swapWith < subs.length) {
          const a = subs[idx];
          const b = subs[swapWith];
          const nextSubs = subs.map((e) => {
            if (e.id === a.id) return { ...e, sort_order: b.sort_order };
            if (e.id === b.id) return { ...e, sort_order: a.sort_order };
            return e;
          });
          setDepthCache((prev) => ({
            ...prev,
            [params.squadTeam]: {
              depthEntries: prev[params.squadTeam]?.depthEntries ?? [],
              subEntries: nextSubs,
            },
          }));
          return nextSubs;
        }
        return subs;
      }

      const workspaceId = workspaceIdForSquad(params.squadTeam);
      if (!workspaceId) throw new Error('No active workspace');

      let squadPlayers = playersRef.current.filter(
        (p) => p.squad_team === params.squadTeam
      );
      if (liveModeRef.current) {
        const live = await fetchLiveMasterState(mastersRef.current);
        squadPlayers = liveSquadPlayersForTeam(
          playersRef.current,
          params.squadTeam,
          { ...live, masters: mastersRef.current }
        );
      }

      // Ensure bench rows exist (Live used to load without syncing).
      if (
        squadPlayers.length > 0 &&
        !(depthCacheRef.current[params.squadTeam]?.subEntries ?? []).some(
          (e) => e.player_id === params.playerId
        )
      ) {
        const synced = await syncAndLoadSquad(
          rosterId,
          params.squadTeam,
          workspaceId,
          squadPlayers
        );
        setDepthCache((prev) => ({ ...prev, [params.squadTeam]: synced }));
      }

      const entries = await moveSubOrderEntry({
        rosterId,
        squadTeam: params.squadTeam,
        workspaceId,
        playerId: params.playerId,
        direction: params.direction,
      });
      setDepthCache((prev) => ({
        ...prev,
        [params.squadTeam]: {
          depthEntries: prev[params.squadTeam]?.depthEntries ?? [],
          subEntries: entries,
        },
      }));
      void persistSnapshot();
      return entries;
    },
    [rosterId, queueIfNeeded, persistSnapshot]
  );

  const applyAvailablePlan = useCallback(async (planned: AvailableRankPlan[]) => {
    const byId = new Map(planned.map((r) => [r.playerId, r]));
    const dirty = planned.filter((row) => {
      const current = playersRef.current.find((p) => p.id === row.playerId);
      if (!current) return true;
      return (
        current.team_rank !== row.team_rank ||
        Boolean(current.available_pinned) !== Boolean(row.available_pinned)
      );
    });
    const nextPlayers = playersRef.current.map((p) => {
      const row = byId.get(p.id);
      if (!row) return p;
      return {
        ...p,
        team_rank: row.team_rank,
        available_pinned: row.available_pinned,
      };
    });
    setPlayers(nextPlayers);
    playersRef.current = nextPlayers;
    if (dirty.length === 0) return;
    // Offline / outbox: local ranks only; rank ops enqueue separately.
    if (!replayingRef.current && shouldQueueRef.current) {
      return;
    }
    muteRealtimeBriefly(2000);
    if (liveModeRef.current) {
      await adminLiveSetPoolRanks({
        masters: mastersRef.current,
        ranks: dirty,
      });
      return;
    }
    const workspaceId = workspaceIdRef.current;
    if (!workspaceId) throw new Error('No active workspace');
    await setPlayerTeamRanks(dirty, workspaceId);
  }, []);

  const ensureAvailableRanks = useCallback(async () => {
    const pools: RankPool[] = ['available', 'unavailable'];
    for (const pool of pools) {
      const list = playersInRankPool(playersRef.current, pool);
      if (list.length === 0) continue;
      const planned = planAvailableRanks(list);
      if (!ranksNeedSync(list, planned)) continue;
      await applyAvailablePlan(planned);
    }
  }, [applyAvailablePlan]);

  const moveAvailable = useCallback(
    async (params: {
      playerId: string;
      direction: 'up' | 'down';
      grade?: GradeFilter;
      pool?: RankPool;
    }) => {
      const pool = params.pool ?? 'available';
      const available = playersInRankPool(playersRef.current, pool);
      const planned = moveAvailableInFilter({
        available,
        grade: params.grade ?? 'all',
        playerId: params.playerId,
        direction: params.direction,
      });
      if (!planned) return;
      await applyAvailablePlan(planned);
      if (
        await queueIfNeeded({
          type: 'moveAvailable',
          playerId: params.playerId,
          direction: params.direction,
          grade: params.grade,
          pool: params.pool,
        })
      ) {
        return;
      }
      void persistSnapshot();
    },
    [applyAvailablePlan, queueIfNeeded, persistSnapshot]
  );

  const toggleAvailablePinAction = useCallback(
    async (params: {
      playerId: string;
      grade?: GradeFilter;
      pool?: RankPool;
    }) => {
      const pool = params.pool ?? 'available';
      const available = playersInRankPool(playersRef.current, pool);
      const planned = toggleAvailablePin({
        available,
        grade: params.grade ?? 'all',
        playerId: params.playerId,
      });
      if (!planned) return;
      await applyAvailablePlan(planned);
      if (
        await queueIfNeeded({
          type: 'toggleAvailablePin',
          playerId: params.playerId,
          grade: params.grade,
          pool: params.pool,
        })
      ) {
        return;
      }
      void persistSnapshot();
    },
    [applyAvailablePlan, queueIfNeeded, persistSnapshot]
  );

  const moveAvailableToTopAction = useCallback(
    async (params: {
      playerId: string;
      grade?: GradeFilter;
      pool?: RankPool;
    }) => {
      const pool = params.pool ?? 'available';
      const available = playersInRankPool(playersRef.current, pool);
      const planned = moveAvailableToTop({
        available,
        grade: params.grade ?? 'all',
        playerId: params.playerId,
      });
      if (!planned) return;
      await applyAvailablePlan(planned);
      if (
        await queueIfNeeded({
          type: 'moveAvailableToTop',
          playerId: params.playerId,
          grade: params.grade,
          pool: params.pool,
        })
      ) {
        return;
      }
      void persistSnapshot();
    },
    [applyAvailablePlan, queueIfNeeded, persistSnapshot]
  );

  const moveAvailableToBottomAction = useCallback(
    async (params: {
      playerId: string;
      grade?: GradeFilter;
      pool?: RankPool;
    }) => {
      const pool = params.pool ?? 'available';
      const available = playersInRankPool(playersRef.current, pool);
      const planned = moveAvailableToBottom({
        available,
        grade: params.grade ?? 'all',
        playerId: params.playerId,
      });
      if (!planned) return;
      await applyAvailablePlan(planned);
      if (
        await queueIfNeeded({
          type: 'moveAvailableToBottom',
          playerId: params.playerId,
          grade: params.grade,
          pool: params.pool,
        })
      ) {
        return;
      }
      void persistSnapshot();
    },
    [applyAvailablePlan, queueIfNeeded, persistSnapshot]
  );

  const resetAvailableOrder = useCallback(
    async (pool: RankPool = 'available') => {
      const available = playersInRankPool(playersRef.current, pool);
      if (available.length === 0) return;
      const planned = resetAvailableDefaultOrder(available);
      await applyAvailablePlan(planned);
      if (await queueIfNeeded({ type: 'resetAvailableOrder', pool })) {
        return;
      }
      void persistSnapshot();
    },
    [applyAvailablePlan, queueIfNeeded, persistSnapshot]
  );

  const removeFromLiveTeam = useCallback(
    async (playerId: string, squadTeam: SquadTeam) => {
      if (
        await queueIfNeeded({
          type: 'adminLiveRemoveFromTeam',
          playerId,
          squadTeam,
        })
      ) {
        applyOfflineRemoveFromTeam(playerId, squadTeam);
        const next = playersRef.current.map((p) =>
          p.id === playerId && p.squad_team === squadTeam
            ? { ...p, squad_team: null, available_pinned: false }
            : p
        );
        setPlayers(next);
        playersRef.current = next;
        return;
      }

      const live = await fetchLiveMasterState(mastersRef.current);
      await adminLiveRemoveFromTeam({
        rosterId,
        masters: mastersRef.current,
        playerId,
        squadTeam,
        players: playersRef.current,
        claimsByPlayer: live.claimsByPlayer,
      });
      muteRealtimeBriefly(4000);
      await refreshMasterClaims();
      await refreshLivePlayers({ forceSync: true });
      void persistSnapshot();
    },
    [
      rosterId,
      queueIfNeeded,
      applyOfflineRemoveFromTeam,
      refreshMasterClaims,
      refreshLivePlayers,
      persistSnapshot,
    ]
  );

  const replayApiRef = useRef({
    assignSquad,
    savePlayer,
    removePlayer,
    changePositions,
    moveDepth,
    setStarter,
    moveSub,
    moveAvailable,
    toggleAvailablePinAction,
    moveAvailableToTopAction,
    moveAvailableToBottomAction,
    resetAvailableOrder,
    removeFromLiveTeam,
  });
  replayApiRef.current = {
    assignSquad,
    savePlayer,
    removePlayer,
    changePositions,
    moveDepth,
    setStarter,
    moveSub,
    moveAvailable,
    toggleAvailablePinAction,
    moveAvailableToTopAction,
    moveAvailableToBottomAction,
    resetAvailableOrder,
    removeFromLiveTeam,
  };

  const persistSnapshotRef = useRef(persistSnapshot);
  persistSnapshotRef.current = persistSnapshot;

  // Register outbox replay once for provider lifetime (handlers via refs).
  useEffect(() => {
    registerReplay(async (op: OfflineOp) => {
      replayingRef.current = true;
      // Force online write path even if React state still thinks we should queue.
      const prevOnline = isOnlineRef.current;
      const prevShouldQueue = shouldQueueRef.current;
      isOnlineRef.current = true;
      shouldQueueRef.current = false;
      const api = replayApiRef.current;
      try {
        switch (op.type) {
          case 'assignSquad':
            await api.assignSquad(op.playerId, op.team);
            break;
          case 'savePlayer':
            await api.savePlayer(op.playerId, op.input);
            break;
          case 'removePlayer': {
            const player = playersRef.current.find((p) => p.id === op.playerId);
            if (player) await api.removePlayer(player);
            break;
          }
          case 'changePositions':
            await api.changePositions(op.playerId, op.positions);
            break;
          case 'moveDepth':
            await api.moveDepth(op);
            break;
          case 'setStarter':
            await api.setStarter(op);
            break;
          case 'moveSub':
            await api.moveSub(op);
            break;
          case 'moveAvailable':
            await api.moveAvailable(op);
            break;
          case 'toggleAvailablePin':
            await api.toggleAvailablePinAction(op);
            break;
          case 'moveAvailableToTop':
            await api.moveAvailableToTopAction(op);
            break;
          case 'moveAvailableToBottom':
            await api.moveAvailableToBottomAction(op);
            break;
          case 'resetAvailableOrder':
            await api.resetAvailableOrder(op.pool);
            break;
          case 'adminLiveRemoveFromTeam':
            await api.removeFromLiveTeam(op.playerId, op.squadTeam);
            break;
          default:
            break;
        }
      } finally {
        isOnlineRef.current = prevOnline;
        shouldQueueRef.current = prevShouldQueue;
        replayingRef.current = false;
      }
    });
    registerDrainComplete(async () => {
      muteRealtimeBriefly(4000);
      await refreshMasterClaimsRef.current();
      await refreshPlayersRef.current({ forceSync: true });
      await persistSnapshotRef.current();
    });
    retrySync();
    return () => {
      registerReplay(null);
      registerDrainComplete(null);
    };
  }, [registerReplay, registerDrainComplete, retrySync]);

  const value = useMemo<RosterDataValue>(
    () => ({
      rosterId,
      roster,
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
      setStarter,
      moveSub,
      ensureAvailableRanks,
      moveAvailable,
      toggleAvailablePin: toggleAvailablePinAction,
      moveAvailableToTop: moveAvailableToTopAction,
      moveAvailableToBottom: moveAvailableToBottomAction,
      resetAvailableOrder,
      removeFromLiveTeam,
    }),
    [
      rosterId,
      roster,
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
      setStarter,
      moveSub,
      ensureAvailableRanks,
      moveAvailable,
      toggleAvailablePinAction,
      moveAvailableToTopAction,
      moveAvailableToBottomAction,
      resetAvailableOrder,
      removeFromLiveTeam,
    ]
  );

  return (
    <RosterDataContext.Provider value={value}>{children}</RosterDataContext.Provider>
  );
}

export function useRosterData(): RosterDataValue {
  const ctx = useContext(RosterDataContext);
  if (!ctx) {
    throw new Error('useRosterData must be used within RosterDataProvider');
  }
  return ctx;
}