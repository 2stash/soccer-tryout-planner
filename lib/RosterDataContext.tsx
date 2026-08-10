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
  replaceDepthOrderForPosition,
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
  clearTryoutDayTimes as clearTryoutDayTimesApi,
  endTryout as endTryoutApi,
  setTryoutNumberWithPrepopulate,
  startTryout as startTryoutApi,
  upsertTryoutDay,
} from '@/lib/tryout';
import type { PlayerTryoutDay } from '@/lib/types';
import {
  membershipKey,
  optimisticApplyStarterSwap,
  optimisticPatchPositions,
  type DepthCacheMap,
  type SquadDepthCache,
} from '@/lib/squadSections';
import {
  buildSwappedSubOrder,
  listSubOrderEntries,
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
import { useActiveRole } from '@/lib/ActiveRoleContext';
import { useMasterConflicts } from '@/lib/MasterConflictContext';
import { useOffline } from '@/lib/offline/OfflineContext';
import { loadOutbox } from '@/lib/offline/outbox';
import {
  loadRosterSnapshot,
  peekRosterSnapshot,
  saveRosterSnapshot,
} from '@/lib/offline/snapshot';
import type {
  OfflineOp,
  OfflineOpInput,
  OfflineScope,
} from '@/lib/offline/types';
import type {
  Player,
  PlayerAssignment,
  PlayerInput,
  Roster,
  SquadTeam,
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
  /** Admin: enable Tryout mode for 1–5 days. */
  startTryout: (dayCount: number) => Promise<void>;
  /** Admin: leave Tryout mode (keeps attendance / numbers). */
  endTryout: () => Promise<void>;
  /** Set tryout # for a day (prepopulates later empty days). */
  setTryoutNumber: (
    playerId: string,
    day: number,
    tryoutNumber: number | null
  ) => Promise<void>;
  /** Toggle / set attendance for a tryout day. */
  setTryoutAttended: (
    playerId: string,
    day: number,
    attended: boolean
  ) => Promise<void>;
  /** Save Time Trial finish elapsed ms for a tryout day. */
  setTryoutTimeTrial: (
    playerId: string,
    day: number,
    timeTrialMs: number | null
  ) => Promise<void>;
  /** Clear all saved time-trial times for a day (optimistic + one server update). */
  clearTryoutDayTimes: (day: number) => Promise<void>;
  /**
   * Local Time Trial stopwatch (survives tab changes within this roster).
   * Not synced — only finish times are persisted.
   */
  timeTrialDay: number;
  timeTrialStartedAt: number | null;
  timeTrialStoppedAt: number | null;
  setTimeTrialDay: (day: number) => void;
  startTimeTrialClock: () => void;
  endTimeTrialClock: () => void;
  /** Reset local stopwatch to 0 (does not clear saved player times). */
  clearTimeTrialClock: () => void;
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

/** Read-only depth/sub load — does not rebuild or reindex server rows. */
async function loadSquadDepthOnly(
  rosterId: string,
  squadTeam: SquadTeam,
  workspaceId: string
): Promise<SquadDepthCache> {
  const [depthEntries, subEntries] = await Promise.all([
    listDepthChartEntries(rosterId, squadTeam, workspaceId),
    listSubOrderEntries(rosterId, squadTeam, workspaceId),
  ]);
  return { depthEntries, subEntries };
}

function maxUpdatedAt(isos: Array<string | null | undefined>): string | null {
  let max: string | null = null;
  for (const value of isos) {
    if (!value) continue;
    if (!max || value > max) max = value;
  }
  return max;
}

function watermarkFromPlayersAndDepth(
  players: Player[],
  depth: DepthCacheMap
): string | null {
  const stamps: Array<string | null | undefined> = players.map(
    (p) => p.updated_at
  );
  for (const cache of Object.values(depth)) {
    if (!cache) continue;
    for (const e of cache.depthEntries) stamps.push(e.updated_at);
    for (const e of cache.subEntries) stamps.push(e.updated_at);
  }
  return maxUpdatedAt(stamps);
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
    loading: roleLoading,
  } = useActiveRole();
  const {
    refresh: refreshMasterClaims,
    exportSnapshotSlice,
    hydrateFromSnapshot,
  } = useMasterConflicts();
  const {
    isOnline,
    shouldQueueWrites,
    scope,
    outboxReady,
    pendingCount,
    isSyncing,
    enqueue,
    registerReplay,
    registerDrainComplete,
    registerConflictHandlers,
    setOfflineReady,
    retrySync,
  } = useOffline();
  const bootSnap = peekRosterSnapshot({ rosterId, workspaceId: '' });
  const [roster, setRoster] = useState<Roster | null>(
    () => bootSnap?.roster ?? null
  );
  const [players, setPlayers] = useState<Player[]>(
    () => bootSnap?.players ?? []
  );
  const [depthCache, setDepthCache] = useState<DepthCacheMap>(
    () => bootSnap?.depthCache ?? {}
  );
  const [loading, setLoading] = useState(() => !bootSnap);
  const [depthReady, setDepthReady] = useState(() => Boolean(bootSnap));
  const [error, setError] = useState<string | null>(null);
  const [timeTrialDay, setTimeTrialDay] = useState(1);
  const [timeTrialStartedAt, setTimeTrialStartedAt] = useState<number | null>(
    null
  );
  const [timeTrialStoppedAt, setTimeTrialStoppedAt] = useState<number | null>(
    null
  );

  const membershipRef = useRef(
    bootSnap ? membershipKey(bootSnap.players) : ''
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncingRef = useRef(false);
  const muteRealtimeUntilRef = useRef(0);
  /** Max updated_at from last successful remote reconcile (ISO). */
  const lastPulledAtRef = useRef<string | null>(null);
  const rosterIdRef = useRef(rosterId);
  rosterIdRef.current = rosterId;
  const workspaceIdRef = useRef(activeWorkspaceId);
  workspaceIdRef.current = activeWorkspaceId;
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
  const pendingCountRef = useRef(pendingCount);
  pendingCountRef.current = pendingCount;
  const isSyncingRef = useRef(isSyncing);
  isSyncingRef.current = isSyncing;
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
  /** Scope key currently painted in memory — used to drop stale workspace UI. */
  const paintedScopeKeyRef = useRef(bootSnap ? rosterId : '');

  // Apply master-conflict slice from the sync boot snapshot once.
  useEffect(() => {
    if (!bootSnap) return;
    try {
      hydrateFromSnapshotRef.current?.({
        claimsEntries: bootSnap.claimsEntries,
        claimedPlayers: bootSnap.claimedPlayers,
        depthByKind: bootSnap.depthByKind,
      });
    } catch {
      // Conflict provider may be a stub.
    }
    setOfflineReadyRef.current(true);
    // Intentionally once per mount / bootSnap identity for this rosterId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterId]);

  const persistSnapshot = useCallback(async () => {
    const s = scopeRef.current;
    if (!s) return;
    if (playersRef.current.length === 0 && !rosterRef.current) return;
    const slice = exportSnapshotSliceRef.current();
    await saveRosterSnapshot({
      version: 2,
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

  function workspaceIdForSquad(_squad: SquadTeam): string | null {
    return workspaceIdRef.current;
  }

  /** Writer-only echo mute. Receivers must not call this for remote events. */
  function muteRealtimeBriefly(ms = 1500) {
    muteRealtimeUntilRef.current = Date.now() + ms;
  }

  const clearError = useCallback(() => setError(null), []);

  const syncDepthForPlayers = useCallback(async (nextPlayers: Player[]) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const id = rosterIdRef.current;
    try {
      const nextCache: DepthCacheMap = {};
      const workspaceId = workspaceIdRef.current;

      for (const team of SQUAD_TEAMS) {
        const squadPlayers = nextPlayers.filter((p) => p.squad_team === team.id);
        if (squadPlayers.length === 0 || !workspaceId) {
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

  const refreshPlayers = useCallback(
    async (opts?: { forceSync?: boolean; skipDepthSync?: boolean }) => {
      const workspaceId = workspaceIdRef.current;
      if (!workspaceId) return;
      const data = await listPlayers(rosterIdRef.current, workspaceId);
      await applyPlayers(data, opts);
    },
    [applyPlayers]
  );

  const refreshPlayersRef = useRef(refreshPlayers);
  refreshPlayersRef.current = refreshPlayers;

  const loadDepthListsForPlayers = useCallback(
    async (_nextPlayers: Player[]): Promise<DepthCacheMap> => {
      const id = rosterIdRef.current;
      const nextCache: DepthCacheMap = {};
      const workspaceId = workspaceIdRef.current;

      await Promise.all(
        SQUAD_TEAMS.map(async (team) => {
          if (!workspaceId) {
            nextCache[team.id] = { depthEntries: [], subEntries: [] };
            return;
          }
          nextCache[team.id] = await loadSquadDepthOnly(
            id,
            team.id,
            workspaceId
          );
        })
      );
      return nextCache;
    },
    []
  );

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
    try {
      hydrateFromSnapshotRef.current?.({
        claimsEntries: snap.claimsEntries,
        claimedPlayers: snap.claimedPlayers,
        depthByKind: snap.depthByKind,
      });
    } catch {
      // Conflict provider may be a stub — snapshot players/depth still apply.
    }
    setOfflineReadyRef.current(true);
    setError(null);
    return true;
  }

  // Cache-first load: paint AsyncStorage snapshot by rosterId immediately
  // (do not wait for roles/workspace). Soft-refresh from server once workspace
  // is known — without wiping the tab shell.
  useEffect(() => {
    let active = true;
    const nextScopeKey = rosterId;
    const loadScope: OfflineScope = scope ?? {
      rosterId,
      workspaceId: activeWorkspaceId ?? '',
    };

    // Switching teams: drop previous paint only when roster id actually changes.
    if (
      paintedScopeKeyRef.current &&
      paintedScopeKeyRef.current !== nextScopeKey
    ) {
      paintedScopeKeyRef.current = '';
      membershipRef.current = '';
      lastPulledAtRef.current = null;
      setRoster(null);
      rosterRef.current = null;
      setPlayers([]);
      playersRef.current = [];
      setDepthCache({});
      depthCacheRef.current = {};
      setDepthReady(false);
      setLoading(true);
    }

    (async () => {
      setError(null);

      // 1) Instant local paint — runs even while roles/outbox are still loading.
      const alreadyPainted =
        paintedScopeKeyRef.current === nextScopeKey &&
        (playersRef.current.length > 0 || Boolean(rosterRef.current));
      let snapOk = alreadyPainted;
      if (!alreadyPainted) {
        snapOk = await hydrateFromSnap(loadScope);
        if (!active) return;
        if (snapOk) {
          paintedScopeKeyRef.current = nextScopeKey;
          setLoading(false);
        } else {
          paintedScopeKeyRef.current = '';
          membershipRef.current = '';
          lastPulledAtRef.current = null;
          setPlayers([]);
          playersRef.current = [];
          setDepthCache({});
          depthCacheRef.current = {};
          setDepthReady(false);
          setLoading(true);
        }
      }

      if (!isOnlineRef.current) {
        if (!snapOk && active) {
          setError('Connect once online to use this roster offline.');
          setOfflineReadyRef.current(false);
        }
        if (active) setLoading(false);
        return;
      }

      // Network refresh needs workspace + roles; snapshot paint already done.
      if (roleLoading || !activeWorkspaceId || !outboxReady) {
        return;
      }

      const workspaceId = activeWorkspaceId;
      const pending = await loadOutbox(loadScope);
      if (!active) return;
      if (pending.length > 0) {
        // Keep optimistic snapshot; drain-complete force-reconciles from server.
        if (!snapOk) {
          const ok = await hydrateFromSnap(loadScope);
          if (ok && active) {
            paintedScopeKeyRef.current = nextScopeKey;
            setLoading(false);
          }
        }
        if (active) {
          setLoading(false);
          retrySync();
        }
        return;
      }

      // 2) Background network refresh — do not flip loading back to true.
      try {
        const r = await getRoster(rosterId);
        if (!active) return;
        if (!r) {
          if (!snapOk) {
            setError('Roster not found');
            setRoster(null);
            setPlayers([]);
          }
          return;
        }
        setRoster(r);
        rosterRef.current = r;
        const data = await listPlayers(rosterId, workspaceId);
        if (!active) return;
        setPlayers(data);
        playersRef.current = data;
        const nextKey = membershipKey(data);
        if (snapOk && nextKey === membershipRef.current) {
          const lists = await loadDepthListsForPlayers(data);
          setDepthCache(lists);
          depthCacheRef.current = lists;
          setDepthReady(true);
        } else {
          await syncDepthForPlayers(data);
        }
        lastPulledAtRef.current =
          watermarkFromPlayersAndDepth(data, depthCacheRef.current) ??
          new Date().toISOString();
        if (active) {
          paintedScopeKeyRef.current = nextScopeKey;
          const stillPending = await loadOutbox(loadScope);
          if (stillPending.length === 0) {
            await persistSnapshot();
          } else {
            retrySync();
          }
        }
      } catch (e) {
        if (!snapOk) {
          const ok = await hydrateFromSnap(loadScope);
          if (ok && active) {
            paintedScopeKeyRef.current = nextScopeKey;
          } else if (!ok && active) {
            setError(e instanceof Error ? e.message : 'Failed to load roster');
          }
        }
        // If we already painted from cache, keep it — silent background failure.
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
    outboxReady,
    scope,
    syncDepthForPlayers,
    loadDepthListsForPlayers,
    persistSnapshot,
    retrySync,
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

  /**
   * Single entry for realtime / focus / poll / post-drain.
   * Reloads players + depth/sub *lists* (not sync rebuild) so remote starter
   * edits show up. Rebuilds depth only when squad membership changes.
   */
  const reconcileFromServer = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!isOnlineRef.current) return;
      // Writer echo mute — receivers never set this for someone else's writes.
      if (!opts?.force && Date.now() < muteRealtimeUntilRef.current) return;
      if (
        !opts?.force &&
        (pendingCountRef.current > 0 || isSyncingRef.current)
      ) {
        return;
      }

      const workspaceId = workspaceIdRef.current;
      if (!workspaceId) return;
      const id = rosterIdRef.current;

      try {
        await refreshMasterClaimsRef
          .current(opts?.force ? { force: true } : undefined)
          .catch(() => {});

        const [nextPlayers, nextRoster] = await Promise.all([
          listPlayers(id, workspaceId),
          getRoster(id),
        ]);
        if (nextRoster) {
          setRoster(nextRoster);
          rosterRef.current = nextRoster;
        }

        const nextKey = membershipKey(nextPlayers);
        const membershipChanged = nextKey !== membershipRef.current;

        let nextDepth: DepthCacheMap;
        if (membershipChanged) {
          // New/removed squad members — repair depth rows on server.
          setPlayers(nextPlayers);
          playersRef.current = nextPlayers;
          await syncDepthForPlayers(nextPlayers);
          nextDepth = depthCacheRef.current;
        } else {
          nextDepth = await loadDepthListsForPlayers(nextPlayers);
          const watermark = watermarkFromPlayersAndDepth(
            nextPlayers,
            nextDepth
          );
          if (
            !opts?.force &&
            watermark &&
            lastPulledAtRef.current &&
            watermark <= lastPulledAtRef.current
          ) {
            return;
          }
          setPlayers(nextPlayers);
          playersRef.current = nextPlayers;
          setDepthCache(nextDepth);
          depthCacheRef.current = nextDepth;
          membershipRef.current = nextKey;
          setDepthReady(true);
        }

        const watermark = watermarkFromPlayersAndDepth(
          nextPlayers,
          depthCacheRef.current
        );
        lastPulledAtRef.current =
          watermark ?? new Date().toISOString();
      } catch {
        // Background reconcile — silent retry on next event/poll.
      }
    },
    [loadDepthListsForPlayers, syncDepthForPlayers]
  );

  const reconcileFromServerRef = useRef(reconcileFromServer);
  reconcileFromServerRef.current = reconcileFromServer;

  // Catch missed realtime (idle desktop tabs) via focus + light polling.
  useForegroundRefresh(
    Boolean(isOnline && !roleLoading && activeWorkspaceId),
    () => {
      void reconcileFromServer();
    },
    12_000
  );

  // Realtime only while online.
  const [realtimeEpoch, setRealtimeEpoch] = useState(0);
  useEffect(() => {
    if (roleLoading || !isOnline || !activeWorkspaceId) return;

    const onRealtime = () => {
      if (!isOnlineRef.current) return;
      // Writer mute only — remote devices apply immediately.
      if (Date.now() < muteRealtimeUntilRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void reconcileFromServer();
      }, 300);
    };

    const onStatus = (status: string) => {
      // Do not resubscribe on CLOSED — that fires on intentional teardown too.
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setRealtimeEpoch((n) => n + 1);
      }
    };

    const channel = subscribeToPlayers(
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
    isOnline,
    realtimeEpoch,
    reconcileFromServer,
  ]);

  const savePlayer = useCallback(
    async (playerId: string, input: PlayerInput) => {
      const prev = playersRef.current.find((p) => p.id === playerId);
      const workspaceId = workspaceIdRef.current;
      if (!workspaceId) throw new Error('No active workspace');

      const nextPositions = normalizePositions(input.positions);
      const optimisticPlayer: Player = {
        ...(prev as Player),
        first_name: input.first_name,
        last_name: input.last_name,
        school_year: input.school_year,
        positions: nextPositions,
        position: formatPositionsShort(nextPositions),
      };

      // Apply locally first so edit sheets can close without a Saving… wait.
      const applyLocal = (row: Player) => {
        const next = playersRef.current.map((p) =>
          p.id === playerId ? row : p
        );
        setPlayers(next);
        playersRef.current = next;
        return next;
      };

      if (await queueIfNeeded({ type: 'savePlayer', playerId, input })) {
        applyLocal(optimisticPlayer);
        return optimisticPlayer;
      }

      const next = applyLocal(optimisticPlayer);
      muteRealtimeBriefly();
      membershipRef.current = membershipKey(next);

      const prevPositions = normalizePositions(prev?.positions);
      const positionsChanged =
        prevPositions.join(',') !== nextPositions.join(',');

      if (positionsChanged && isSquadTeam(optimisticPlayer.squad_team)) {
        const squadTeam = optimisticPlayer.squad_team;
        const squadPlayers = next.filter((p) => p.squad_team === squadTeam);

        const optimisticCache = optimisticPatchPositions({
          cache: depthCacheRef.current[squadTeam],
          squadPlayers,
          player: optimisticPlayer,
          prevPositions,
          nextPositions,
        });
        setDepthCache((prevCache) => ({
          ...prevCache,
          [squadTeam]: optimisticCache,
        }));

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

      try {
        const updated = await updatePlayer(playerId, input, workspaceId);
        applyLocal(updated);
        membershipRef.current = membershipKey(playersRef.current);
        return updated;
      } catch (e) {
        if (prev) applyLocal(prev);
        throw e;
      }
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
        // Capture absolute pool ranks so replay doesn't recompute a different order.
        const pools: RankPool[] = ['available', 'unavailable'];
        for (const pool of pools) {
          const list = playersInRankPool(playersRef.current, pool);
          if (list.length === 0) continue;
          const planned = planAvailableRanks(list);
          if (!ranksNeedSync(list, planned)) continue;
          const byId = new Map(planned.map((r) => [r.playerId, r]));
          const ranked = playersRef.current.map((p) => {
            const row = byId.get(p.id);
            if (!row) return p;
            return {
              ...p,
              team_rank: row.team_rank,
              available_pinned: row.available_pinned,
            };
          });
          setPlayers(ranked);
          playersRef.current = ranked;
          await enqueue({
            type: 'syncAvailableRanks',
            pool,
            ranks: planned,
          });
        }
        await persistSnapshot();
        return;
      }

      // Optimistic local move first so UI updates before the network round-trip.
      const optimistic: Player = {
        ...(prev as Player),
        squad_team: team,
        available_pinned: false,
      };
      let next = playersRef.current.map((p) =>
        p.id === playerId ? optimistic : p
      );
      setPlayers(next);
      playersRef.current = next;
      muteRealtimeBriefly();
      membershipRef.current = membershipKey(next);

      let updated: Player;
      try {
        updated =
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
      } catch (e) {
        if (prev) {
          next = playersRef.current.map((p) =>
            p.id === playerId ? prev : p
          );
          setPlayers(next);
          playersRef.current = next;
          membershipRef.current = membershipKey(next);
        }
        throw e;
      }

      next = playersRef.current.map((p) =>
        p.id === playerId ? updated : p
      );
      setPlayers(next);
      playersRef.current = next;
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

      // Keep Available / Unavailable team_rank contiguous after pool moves.
      // Skip while replaying — absolute syncAvailableRanks ops follow in the outbox.
      if (!replayingRef.current) {
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
          muteRealtimeBriefly(1500);
          await setPlayerTeamRanks(planned, workspaceId);
        }
      }
      void persistSnapshot();
    },
    [rosterId, queueIfNeeded, persistSnapshot, enqueue]
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
      orderedPlayerIds?: string[];
    }) => {
      // Replay with absolute order — write-only, no relative double-apply.
      if (replayingRef.current && params.orderedPlayerIds?.length) {
        const workspaceId = workspaceIdForSquad(params.squadTeam);
        if (!workspaceId) throw new Error('No active workspace');
        return replaceDepthOrderForPosition({
          rosterId,
          squadTeam: params.squadTeam,
          workspaceId,
          positionNumber: params.positionNumber,
          orderedPlayerIds: params.orderedPlayerIds,
        });
      }

      const cache = depthCacheRef.current[params.squadTeam];
      const canonical = getDepthCanonicalPosition(params.positionNumber);
      const entries = [...(cache?.depthEntries ?? [])];
      const atPos = entries
        .filter((e) => e.position_number === canonical)
        .sort((a, b) => a.sort_order - b.sort_order);
      const idx = atPos.findIndex((e) => e.player_id === params.playerId);
      const swapWith = params.direction === 'up' ? idx - 1 : idx + 1;
      let nextAtPos = atPos;
      let nextEntries = entries;
      if (idx >= 0 && swapWith >= 0 && swapWith < atPos.length) {
        const a = atPos[idx];
        const b = atPos[swapWith];
        nextAtPos = atPos.map((e) => {
          if (e.id === a.id) return { ...e, sort_order: b.sort_order };
          if (e.id === b.id) return { ...e, sort_order: a.sort_order };
          return e;
        });
        nextAtPos = [...nextAtPos].sort((x, y) => x.sort_order - y.sort_order);
        nextEntries = entries.map((e) => {
          if (e.id === a.id) return { ...e, sort_order: b.sort_order };
          if (e.id === b.id) return { ...e, sort_order: a.sort_order };
          return e;
        });
      }
      const orderedPlayerIds = nextAtPos.map((e) => e.player_id);

      if (
        await queueIfNeeded({
          type: 'moveDepth',
          squadTeam: params.squadTeam,
          positionNumber: params.positionNumber,
          playerId: params.playerId,
          direction: params.direction,
          orderedPlayerIds,
        })
      ) {
        setDepthCache((prev) => ({
          ...prev,
          [params.squadTeam]: {
            depthEntries: nextEntries,
            subEntries: prev[params.squadTeam]?.subEntries ?? [],
          },
        }));
        return nextEntries;
      }

      const workspaceId = workspaceIdForSquad(params.squadTeam);
      if (!workspaceId) throw new Error('No active workspace');
      muteRealtimeBriefly(1500);
      const serverEntries = await moveDepthChartEntry({
        rosterId,
        squadTeam: params.squadTeam,
        workspaceId,
        positionNumber: params.positionNumber,
        playerId: params.playerId,
        direction: params.direction,
      });
      const squadPlayers = playersRef.current.filter(
        (p) => p.squad_team === params.squadTeam
      );
      await refreshSquadCache(params.squadTeam, squadPlayers);
      void persistSnapshot();
      return serverEntries;
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
      /** Captured at offline edit time — prefer on replay. */
      desiredSubIds?: string[];
      nextPositions?: number[];
      needsTeamMove?: boolean;
      /** Legacy offline op field — ignored (shared workspace). */
      liveNeedsAssign?: boolean;
      needsPosition?: boolean;
    }) => {
      const incomingId = params.playerId;
      const outgoingId =
        params.outgoingPlayerId && params.outgoingPlayerId !== incomingId
          ? params.outgoingPlayerId
          : null;
      const replaying = replayingRef.current;

      const workingBase = playersRef.current;
      const player = workingBase.find((p) => p.id === incomingId);
      if (!player) {
        const message = 'Player not found.';
        setError(message);
        throw new Error(message);
      }

      const prevTeam = player.squad_team;
      const canonical = getDepthCanonicalPosition(params.positionNumber);
      const computedNeedsPosition = !playerInDepthGroup(
        player.positions,
        params.positionNumber
      );
      const computedNextPositions = computedNeedsPosition
        ? [...new Set([...normalizePositions(player.positions), canonical])].sort(
            (a, b) => a - b
          )
        : normalizePositions(player.positions);
      const computedNeedsTeamMove = prevTeam !== params.squadTeam;

      // On replay, trust flags captured when the user made the edit — local
      // playersRef is already optimistic so recomputing would skip the assign.
      const needsPosition =
        params.needsPosition ?? computedNeedsPosition;
      const nextPositions = params.nextPositions ?? computedNextPositions;
      const needsTeamMove = params.needsTeamMove ?? computedNeedsTeamMove;

      const priorCache = depthCacheRef.current[params.squadTeam];
      const priorDepthCacheSnapshot = depthCacheRef.current;
      const priorSquadPlayers = workingBase.filter(
        (p) => p.squad_team === params.squadTeam
      );
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

      const patchedById = new Map(working.map((p) => [p.id, p]));
      const targetSquadPlayers = working
        .filter((p) => p.squad_team === params.squadTeam)
        .map((p) => {
          const patched = patchedById.get(p.id);
          return patched
            ? { ...patched, squad_team: params.squadTeam }
            : { ...p, squad_team: params.squadTeam };
        });
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

      const computedDesiredSubIds = buildSwappedSubOrder({
        previousSubIds,
        incomingPlayerId: incomingId,
        outgoingPlayerId: outgoingId,
        incomingSubIndex: params.incomingSubIndex ?? null,
      });
      // Prefer absolute bench order captured at offline edit time.
      const desiredSubIds = params.desiredSubIds ?? computedDesiredSubIds;

      const swapGen = ++starterSwapGenRef.current;

      // Skip re-applying optimistic UI on replay — local state already matches.
      if (!replaying) {
        setError(null);
        setPlayers(working);
        playersRef.current = working;
        setDepthCache((prev) => ({
          ...prev,
          [params.squadTeam]: optimisticCache,
        }));
        muteRealtimeBriefly(10000);
        membershipRef.current = membershipKey(working);
      }

      const persist = async () => {
        const workspaceId = workspaceIdForSquad(params.squadTeam);
        if (!workspaceId) throw new Error('No active workspace');

        // Outbox replay: server writes only — do not touch React state (avoids
        // the "figuring out starters" flicker; local UI is already correct).
        if (replaying) {
          if (needsTeamMove || needsPosition) {
            await patchPlayer(
              incomingId,
              {
                ...(needsTeamMove ? { squad_team: params.squadTeam } : {}),
                ...(needsPosition ? { positions: nextPositions } : {}),
              },
              workspaceId
            );
          }
          if (outgoingId) {
            // Local row may already show on-team; still ensure server assign.
            await setPlayerSquadTeam(
              outgoingId,
              params.squadTeam,
              workspaceId
            );
          }
          await setDepthStarter({
            rosterId,
            squadTeam: params.squadTeam,
            workspaceId,
            positionNumber: params.positionNumber,
            slotIndex: params.slotIndex,
            playerId: incomingId,
            outgoingPlayerId: outgoingId,
          });
          await replaceSubOrder({
            rosterId,
            squadTeam: params.squadTeam,
            workspaceId,
            orderedPlayerIds: desiredSubIds,
          });
          return;
        }

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
        !replaying &&
        (await queueIfNeeded({
          type: 'setStarter',
          squadTeam: params.squadTeam,
          positionNumber: params.positionNumber,
          slotIndex: params.slotIndex,
          playerId: incomingId,
          outgoingPlayerId: outgoingId,
          incomingSubIndex: params.incomingSubIndex ?? null,
          desiredSubIds: computedDesiredSubIds,
          nextPositions,
          needsTeamMove,
          needsPosition,
        }))
      ) {
        void persistSnapshot();
        return optimisticCache.depthEntries;
      }

      // Always await on replay so the outbox doesn't shift before the write finishes.
      if (replaying) {
        await persist();
        void persistSnapshot();
        return (
          depthCacheRef.current[params.squadTeam]?.depthEntries ??
          optimisticCache.depthEntries
        );
      }

      // Online: keep snappy background persist.
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
    [rosterId, queueIfNeeded, persistSnapshot]
  );

  const moveSub = useCallback(
    async (params: {
      squadTeam: SquadTeam;
      playerId: string;
      direction: 'up' | 'down';
      orderedPlayerIds?: string[];
    }) => {
      // Replay with absolute bench order.
      if (replayingRef.current && params.orderedPlayerIds?.length) {
        const workspaceId = workspaceIdForSquad(params.squadTeam);
        if (!workspaceId) throw new Error('No active workspace');
        return replaceSubOrder({
          rosterId,
          squadTeam: params.squadTeam,
          workspaceId,
          orderedPlayerIds: params.orderedPlayerIds,
        });
      }

      const subs = [
        ...(depthCacheRef.current[params.squadTeam]?.subEntries ?? []),
      ].sort((a, b) => a.sort_order - b.sort_order);
      const idx = subs.findIndex((e) => e.player_id === params.playerId);
      const swapWith = params.direction === 'up' ? idx - 1 : idx + 1;
      let nextSubs = subs;
      if (idx >= 0 && swapWith >= 0 && swapWith < subs.length) {
        const a = subs[idx];
        const b = subs[swapWith];
        nextSubs = subs.map((e) => {
          if (e.id === a.id) return { ...e, sort_order: b.sort_order };
          if (e.id === b.id) return { ...e, sort_order: a.sort_order };
          return e;
        });
        nextSubs = [...nextSubs].sort((x, y) => x.sort_order - y.sort_order);
      }
      const orderedPlayerIds = nextSubs.map((e) => e.player_id);

      if (
        await queueIfNeeded({
          type: 'moveSub',
          squadTeam: params.squadTeam,
          playerId: params.playerId,
          direction: params.direction,
          orderedPlayerIds,
        })
      ) {
        setDepthCache((prev) => ({
          ...prev,
          [params.squadTeam]: {
            depthEntries: prev[params.squadTeam]?.depthEntries ?? [],
            subEntries: nextSubs,
          },
        }));
        return nextSubs;
      }

      const workspaceId = workspaceIdForSquad(params.squadTeam);
      if (!workspaceId) throw new Error('No active workspace');

      const squadPlayers = playersRef.current.filter(
        (p) => p.squad_team === params.squadTeam
      );

      // Ensure bench rows exist before relative move.
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

      muteRealtimeBriefly(1500);
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

  const applyAvailablePlan = useCallback(
    async (
      planned: AvailableRankPlan[],
      opts?: { forceWrite?: boolean }
    ) => {
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
      const toWrite = opts?.forceWrite ? planned : dirty;
      if (toWrite.length === 0) return;
      // Offline / outbox: local ranks only; rank ops enqueue separately.
      if (!replayingRef.current && shouldQueueRef.current) {
        return;
      }
      muteRealtimeBriefly(2000);
      const workspaceId = workspaceIdRef.current;
      if (!workspaceId) throw new Error('No active workspace');
      await setPlayerTeamRanks(toWrite, workspaceId);
    },
    []
  );

  const ensureAvailableRanks = useCallback(async () => {
    const pools: RankPool[] = ['available', 'unavailable'];
    for (const pool of pools) {
      const list = playersInRankPool(playersRef.current, pool);
      if (list.length === 0) continue;
      const planned = planAvailableRanks(list);
      if (!ranksNeedSync(list, planned)) continue;
      await applyAvailablePlan(planned);
      if (
        await queueIfNeeded({
          type: 'syncAvailableRanks',
          pool,
          ranks: planned,
        })
      ) {
        continue;
      }
      void persistSnapshot();
    }
  }, [applyAvailablePlan, queueIfNeeded, persistSnapshot]);

  const queueAbsoluteRanks = useCallback(
    async (pool: RankPool, planned: AvailableRankPlan[]) => {
      // Always persist the resulting ranks — never a relative direction.
      // Replaying relative moves against already-optimistic local state double-applies.
      if (
        await queueIfNeeded({
          type: 'syncAvailableRanks',
          pool,
          ranks: planned,
        })
      ) {
        return true;
      }
      return false;
    },
    [queueIfNeeded]
  );

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
      if (await queueAbsoluteRanks(pool, planned)) return;
      void persistSnapshot();
    },
    [applyAvailablePlan, queueAbsoluteRanks, persistSnapshot]
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
      if (await queueAbsoluteRanks(pool, planned)) return;
      void persistSnapshot();
    },
    [applyAvailablePlan, queueAbsoluteRanks, persistSnapshot]
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
      if (await queueAbsoluteRanks(pool, planned)) return;
      void persistSnapshot();
    },
    [applyAvailablePlan, queueAbsoluteRanks, persistSnapshot]
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
      if (await queueAbsoluteRanks(pool, planned)) return;
      void persistSnapshot();
    },
    [applyAvailablePlan, queueAbsoluteRanks, persistSnapshot]
  );

  const resetAvailableOrder = useCallback(
    async (pool: RankPool = 'available') => {
      const available = playersInRankPool(playersRef.current, pool);
      if (available.length === 0) return;
      const planned = resetAvailableDefaultOrder(available);
      await applyAvailablePlan(planned);
      if (await queueAbsoluteRanks(pool, planned)) return;
      void persistSnapshot();
    },
    [applyAvailablePlan, queueAbsoluteRanks, persistSnapshot]
  );

  function mergeTryoutDaysLocal(
    playerId: string,
    days: PlayerTryoutDay[]
  ) {
    const next = playersRef.current.map((p) => {
      if (p.id !== playerId) return p;
      const byDay = new Map(
        (p.tryout_days ?? []).map((d) => [d.day, d] as const)
      );
      for (const day of days) byDay.set(day.day, day);
      return {
        ...p,
        tryout_days: [...byDay.values()].sort((a, b) => a.day - b.day),
      };
    });
    setPlayers(next);
    playersRef.current = next;
  }

  const startTryout = useCallback(
    async (dayCount: number) => {
      setError(null);
      try {
        const updated = await startTryoutApi(rosterId, dayCount);
        setRoster(updated);
        rosterRef.current = updated;
        muteRealtimeBriefly();
        void persistSnapshot();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to start tryout');
        throw e;
      }
    },
    [rosterId, persistSnapshot]
  );

  const endTryout = useCallback(async () => {
    setError(null);
    try {
      const updated = await endTryoutApi(rosterId);
      setRoster(updated);
      rosterRef.current = updated;
      muteRealtimeBriefly();
      void persistSnapshot();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to end tryout');
      throw e;
    }
  }, [rosterId, persistSnapshot]);

  const setTryoutNumber = useCallback(
    async (
      playerId: string,
      day: number,
      tryoutNumber: number | null
    ) => {
      const dayCount = rosterRef.current?.tryout_day_count ?? day;
      setError(null);

      if (
        await queueIfNeeded({
          type: 'upsertTryoutDay',
          playerId,
          day,
          tryoutNumber,
          dayCount,
        })
      ) {
        const player = playersRef.current.find((p) => p.id === playerId);
        const dayRow = player?.tryout_days?.find((d) => d.day === day);
        const localDays: PlayerTryoutDay[] = [
          {
            day,
            tryout_number: tryoutNumber,
            attended: dayRow?.attended ?? false,
            time_trial_ms: dayRow?.time_trial_ms ?? null,
          },
        ];
        if (tryoutNumber != null) {
          for (let d = day + 1; d <= dayCount; d++) {
            const existing = player?.tryout_days?.find((x) => x.day === d);
            if (existing?.tryout_number != null) continue;
            localDays.push({
              day: d,
              tryout_number: tryoutNumber,
              attended: existing?.attended ?? false,
              time_trial_ms: existing?.time_trial_ms ?? null,
            });
          }
        }
        mergeTryoutDaysLocal(playerId, localDays);
        void persistSnapshot();
        return;
      }

      try {
        const written = await setTryoutNumberWithPrepopulate({
          playerId,
          day,
          tryoutNumber,
          dayCount,
        });
        mergeTryoutDaysLocal(playerId, written);
        muteRealtimeBriefly();
        void persistSnapshot();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Failed to update tryout number'
        );
        throw e;
      }
    },
    [queueIfNeeded, persistSnapshot]
  );

  const setTryoutAttended = useCallback(
    async (playerId: string, day: number, attended: boolean) => {
      setError(null);
      if (
        await queueIfNeeded({
          type: 'upsertTryoutDay',
          playerId,
          day,
          attended,
        })
      ) {
        const existing = playersRef.current
          .find((p) => p.id === playerId)
          ?.tryout_days?.find((d) => d.day === day);
        mergeTryoutDaysLocal(playerId, [
          {
            day,
            tryout_number: existing?.tryout_number ?? null,
            attended,
            time_trial_ms: existing?.time_trial_ms ?? null,
          },
        ]);
        void persistSnapshot();
        return;
      }

      try {
        const written = await upsertTryoutDay({
          playerId,
          day,
          patch: { attended },
        });
        mergeTryoutDaysLocal(playerId, [written]);
        muteRealtimeBriefly();
        void persistSnapshot();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Failed to update attendance'
        );
        throw e;
      }
    },
    [queueIfNeeded, persistSnapshot]
  );

  const setTryoutTimeTrial = useCallback(
    async (playerId: string, day: number, timeTrialMs: number | null) => {
      setError(null);
      if (
        await queueIfNeeded({
          type: 'upsertTryoutDay',
          playerId,
          day,
          timeTrialMs,
        })
      ) {
        const existing = playersRef.current
          .find((p) => p.id === playerId)
          ?.tryout_days?.find((d) => d.day === day);
        mergeTryoutDaysLocal(playerId, [
          {
            day,
            tryout_number: existing?.tryout_number ?? null,
            attended: existing?.attended ?? false,
            time_trial_ms: timeTrialMs,
          },
        ]);
        void persistSnapshot();
        return;
      }

      try {
        const written = await upsertTryoutDay({
          playerId,
          day,
          patch: { time_trial_ms: timeTrialMs },
        });
        mergeTryoutDaysLocal(playerId, [written]);
        muteRealtimeBriefly();
        void persistSnapshot();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Failed to save time trial'
        );
        throw e;
      }
    },
    [queueIfNeeded, persistSnapshot]
  );

  const clearTryoutDayTimes = useCallback(
    async (day: number) => {
      setError(null);
      const affectedIds = playersRef.current
        .filter((p) =>
          (p.tryout_days ?? []).some(
            (d) => d.day === day && d.time_trial_ms != null
          )
        )
        .map((p) => p.id);

      const applyLocalClear = () => {
        const next = playersRef.current.map((p) => {
          const days = p.tryout_days ?? [];
          if (!days.some((d) => d.day === day && d.time_trial_ms != null)) {
            return p;
          }
          return {
            ...p,
            tryout_days: days.map((d) =>
              d.day === day ? { ...d, time_trial_ms: null } : d
            ),
          };
        });
        setPlayers(next);
        playersRef.current = next;
      };

      // Paint clear immediately, then sync.
      applyLocalClear();
      void persistSnapshot();

      if (affectedIds.length === 0) return;

      if (
        await queueIfNeeded({
          type: 'clearTryoutDayTimes',
          day,
          playerIds: affectedIds,
        })
      ) {
        return;
      }

      try {
        await clearTryoutDayTimesApi({ playerIds: affectedIds, day });
        muteRealtimeBriefly();
        void persistSnapshot();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Failed to clear time trial times'
        );
        throw e;
      }
    },
    [queueIfNeeded, persistSnapshot]
  );

  const startTimeTrialClock = useCallback(() => {
    const t = Date.now();
    setTimeTrialStartedAt(t);
    setTimeTrialStoppedAt(null);
  }, []);

  const endTimeTrialClock = useCallback(() => {
    setTimeTrialStoppedAt((prev) => {
      if (prev != null) return prev;
      return Date.now();
    });
  }, []);

  const clearTimeTrialClock = useCallback(() => {
    setTimeTrialStartedAt(null);
    setTimeTrialStoppedAt(null);
  }, []);

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
    applyAvailablePlan,
    setTryoutNumber,
    setTryoutAttended,
    setTryoutTimeTrial,
    clearTryoutDayTimes,
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
    applyAvailablePlan,
    setTryoutNumber,
    setTryoutAttended,
    setTryoutTimeTrial,
    clearTryoutDayTimes,
  };

  const persistSnapshotRef = useRef(persistSnapshot);
  persistSnapshotRef.current = persistSnapshot;

  // Register outbox replay once for provider lifetime (handlers via refs).
  useEffect(() => {
    registerReplay(async (op: OfflineOp) => {
      replayingRef.current = true;
      // Writer-only: suppress our own realtime echoes while draining.
      muteRealtimeUntilRef.current = Date.now() + 2_500;
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
            // Local row is already gone after offline delete — call API by id.
            await deletePlayer(op.playerId);
            const next = playersRef.current.filter((p) => p.id !== op.playerId);
            if (next.length !== playersRef.current.length) {
              setPlayers(next);
              playersRef.current = next;
              membershipRef.current = membershipKey(next);
            }
            break;
          }
          case 'changePositions':
            await api.changePositions(op.playerId, op.positions);
            break;
          case 'moveDepth':
            if (op.orderedPlayerIds?.length) {
              await api.moveDepth(op);
            }
            // Legacy relative-only ops: already applied locally; skip.
            break;
          case 'setStarter':
            await api.setStarter(op);
            break;
          case 'moveSub':
            if (op.orderedPlayerIds?.length) {
              await api.moveSub(op);
            }
            break;
          case 'moveAvailable':
          case 'toggleAvailablePin':
          case 'moveAvailableToTop':
          case 'moveAvailableToBottom':
          case 'resetAvailableOrder': {
            // Legacy relative ops: local UI already applied — do not re-run the
            // relative move (that double-applies). Push current absolute ranks.
            const pool = op.pool ?? 'available';
            const list = playersInRankPool(playersRef.current, pool);
            const planned = planAvailableRanks(list);
            await api.applyAvailablePlan(planned, { forceWrite: true });
            break;
          }
          case 'syncAvailableRanks':
            // Local memory already matches; force the queued plan to the server.
            await api.applyAvailablePlan(op.ranks, { forceWrite: true });
            break;
          case 'adminLiveRemoveFromTeam':
            // Legacy Live op — clear assignment on shared workspace.
            await api.assignSquad(op.playerId, null);
            break;
          case 'upsertTryoutDay':
            if ('tryoutNumber' in op) {
              await api.setTryoutNumber(
                op.playerId,
                op.day,
                op.tryoutNumber ?? null
              );
            }
            if ('attended' in op && op.attended !== undefined) {
              await api.setTryoutAttended(op.playerId, op.day, op.attended);
            }
            if ('timeTrialMs' in op) {
              await api.setTryoutTimeTrial(
                op.playerId,
                op.day,
                op.timeTrialMs ?? null
              );
            }
            break;
          case 'clearTryoutDayTimes':
            // Local times were already cleared when queued; push the saved ids.
            await clearTryoutDayTimesApi({
              playerIds: op.playerIds,
              day: op.day,
            });
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
      // Mute our own realtime echoes, then force-pull so watermark matches
      // server truth (and startup-with-pending gets a post-drain refresh).
      muteRealtimeUntilRef.current = Date.now() + 1_500;
      await reconcileFromServerRef.current({ force: true });
      await persistSnapshotRef.current();
    });
    registerConflictHandlers({
      getRosterName: () => rosterRef.current?.name ?? 'This team',
      getSnapshot: async () => {
        await persistSnapshotRef.current();
        const s = scopeRef.current;
        if (!s) return null;
        const fromDisk = await loadRosterSnapshot(s);
        if (fromDisk) return fromDisk;
        if (playersRef.current.length === 0 && !rosterRef.current) return null;
        const slice = exportSnapshotSliceRef.current();
        return {
          version: 2 as const,
          scope: s,
          savedAt: Date.now(),
          roster: rosterRef.current,
          players: playersRef.current,
          depthCache: depthCacheRef.current,
          claimsEntries: slice.claimsEntries,
          claimedPlayers: slice.claimedPlayers,
          depthByKind: slice.depthByKind,
        };
      },
      discardLocalAndPull: async () => {
        const s = scopeRef.current;
        if (s) {
          const { clearOfflineCacheForRoster } = await import(
            '@/lib/offline/clearRosterCache'
          );
          await clearOfflineCacheForRoster(s.rosterId);
        }
        muteRealtimeUntilRef.current = Date.now() + 1_500;
        await reconcileFromServerRef.current({ force: true });
        await persistSnapshotRef.current();
      },
    });
    retrySync();
    return () => {
      registerReplay(null);
      registerDrainComplete(null);
      registerConflictHandlers(null);
    };
  }, [
    registerReplay,
    registerDrainComplete,
    registerConflictHandlers,
    retrySync,
  ]);

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
      startTryout,
      endTryout,
      setTryoutNumber,
      setTryoutAttended,
      setTryoutTimeTrial,
      clearTryoutDayTimes,
      timeTrialDay,
      timeTrialStartedAt,
      timeTrialStoppedAt,
      setTimeTrialDay,
      startTimeTrialClock,
      endTimeTrialClock,
      clearTimeTrialClock,
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
      startTryout,
      endTryout,
      setTryoutNumber,
      setTryoutAttended,
      setTryoutTimeTrial,
      clearTryoutDayTimes,
      timeTrialDay,
      timeTrialStartedAt,
      timeTrialStoppedAt,
      startTimeTrialClock,
      endTimeTrialClock,
      clearTimeTrialClock,
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