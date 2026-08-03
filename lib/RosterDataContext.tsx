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
  } = useActiveRole();
  const { refresh: refreshMasterClaims } = useMasterConflicts();
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
  /** Monotonic token so stale background starter writes can't overwrite newer swaps. */
  const starterSwapGenRef = useRef(0);

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

    if (!activeWorkspaceId) {
      setLoading(false);
      setPlayers([]);
      setError('No active workspace for this role.');
      return () => {
        active = false;
      };
    }

    const workspaceId = activeWorkspaceId;
    const live = isAdminLiveMode;

    (async () => {
      setLoading(true);
      setError(null);
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
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : 'Failed to load roster');
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    const onRealtime = () => {
      if (Date.now() < muteRealtimeUntilRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (Date.now() < muteRealtimeUntilRef.current) return;
        void refreshPlayersRef.current().catch((e) => {
          setError(e instanceof Error ? e.message : 'Failed to refresh players');
        });
      }, 300);
    };

    const masterIds = masterWorkspaces(workspaces).map((w) => w.id);
    const channel =
      live && masterIds.length > 0
        ? subscribeToLiveMasterRoster(rosterId, masterIds, onRealtime)
        : subscribeToPlayers(rosterId, workspaceId, onRealtime);

    return () => {
      active = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void unsubscribePlayers(channel);
    };
  }, [
    rosterId,
    activeWorkspaceId,
    roleLoading,
    isAdminLiveMode,
    workspaces,
    syncDepthForPlayers,
  ]);

  const savePlayer = useCallback(
    async (playerId: string, input: PlayerInput) => {
      const prev = players.find((p) => p.id === playerId);
      const workspaceId = workspaceIdRef.current;
      if (!workspaceId) throw new Error('No active workspace');
      const updated = await updatePlayer(playerId, input, workspaceId);
      const next = players.map((p) => (p.id === playerId ? updated : p));
      setPlayers(next);
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

      return updated;
    },
    [players, rosterId]
  );

  const removePlayer = useCallback(
    async (player: Player) => {
      await deletePlayer(player.id);
      const next = players.filter((p) => p.id !== player.id);
      setPlayers(next);
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
    },
    [players, rosterId]
  );

  const assignSquad = useCallback(
    async (playerId: string, team: PlayerAssignment | null) => {
      const prev = players.find((p) => p.id === playerId);
      const workspaceId = workspaceIdRef.current;
      if (!workspaceId) throw new Error('No active workspace');

      if (liveModeRef.current) {
        const live = await fetchLiveMasterState(mastersRef.current);
        await adminLiveAssign({
          rosterId,
          masters: mastersRef.current,
          playerId,
          target: team,
          players,
          claimsByPlayer: live.claimsByPlayer,
        });
        muteRealtimeBriefly(4000);
        // Claims drive Assign / All Players team columns — refresh before UI reads.
        await refreshMasterClaims();
        await refreshLivePlayers({ forceSync: true });
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
      let next = players.map((p) => (p.id === playerId ? updated : p));
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
    },
    [players, rosterId, refreshLivePlayers, refreshMasterClaims]
  );

  const changePositions = useCallback(
    async (playerId: string, positions: number[]) => {
      const prev = players.find((p) => p.id === playerId);
      const workspaceId = workspaceIdRef.current;
      if (!workspaceId) throw new Error('No active workspace');
      const updated = await setPlayerPositions(
        playerId,
        positions,
        workspaceId
      );
      const next = players.map((p) => (p.id === playerId ? updated : p));
      setPlayers(next);
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
    },
    [players, rosterId]
  );

  const moveDepth = useCallback(
    async (params: {
      squadTeam: SquadTeam;
      positionNumber: number;
      playerId: string;
      direction: 'up' | 'down';
    }) => {
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
      return entries;
    },
    [rosterId, refreshSquadCache]
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
        return (
          depthCacheRef.current[params.squadTeam]?.depthEntries ??
          optimisticCache.depthEntries
        );
      }

      // Personal / coach: keep snappy background persist.
      void persist().catch((e) => {
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
    [rosterId, refreshLivePlayers, refreshMasterClaims]
  );

  const moveSub = useCallback(
    async (params: {
      squadTeam: SquadTeam;
      playerId: string;
      direction: 'up' | 'down';
    }) => {
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
      return entries;
    },
    [rosterId]
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
    setPlayers((prev) =>
      prev.map((p) => {
        const row = byId.get(p.id);
        if (!row) return p;
        return {
          ...p,
          team_rank: row.team_rank,
          available_pinned: row.available_pinned,
        };
      })
    );
    if (dirty.length === 0) return;
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
    },
    [applyAvailablePlan]
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
    },
    [applyAvailablePlan]
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
    },
    [applyAvailablePlan]
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
    },
    [applyAvailablePlan]
  );

  const resetAvailableOrder = useCallback(
    async (pool: RankPool = 'available') => {
      const available = playersInRankPool(playersRef.current, pool);
      if (available.length === 0) return;
      const planned = resetAvailableDefaultOrder(available);
      await applyAvailablePlan(planned);
    },
    [applyAvailablePlan]
  );

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