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
import { useActiveRole } from '@/lib/ActiveRoleContext';
import {
  claimsForMaster,
  canonicalSquadForMaster,
  conflictLabelsForPlayer,
  fetchMasterClaims,
  isGloballyUnclaimed,
  isMasterKind,
  masterKindForSquad,
  masterKindShortLabel,
  masterWorkspaces,
  MASTER_KINDS,
  otherMasterClaimTags,
  type MasterClaim,
  type MasterKind,
} from '@/lib/masterConflicts';
import { listDepthChartEntries } from '@/lib/depthChart';
import { useOffline } from '@/lib/offline/OfflineContext';
import { fetchPlayersByIds } from '@/lib/players';
import type { SquadDepthCache } from '@/lib/squadSections';
import { listSubOrderEntries } from '@/lib/subOrder';
import { supabase } from '@/lib/supabase';
import type {
  Player,
  PlayerAssignment,
  SquadTeam,
  Workspace,
} from '@/lib/types';
import { isSquadTeam, UNAVAILABLE_POOL } from '@/lib/types';
import { useForegroundRefresh } from '@/lib/useForegroundRefresh';

export type MasterConflictSnapshotSlice = {
  claimsEntries: [string, MasterClaim[]][];
  claimedPlayers: Player[];
  depthByKind: Partial<Record<MasterKind, SquadDepthCache>>;
};

type MasterConflictValue = {
  /** Short labels like "JV", "Varsity" for conflict chips on own team. */
  labelsFor: (playerId: string) => string[];
  /** Tags like "On JV" for Available/Unavailable rows. */
  availabilityTagsFor: (playerId: string) => string[];
  isGloballyUnclaimed: (playerId: string) => boolean;
  /** Official claims for a player (may be multiple when conflicted). */
  claimsFor: (playerId: string) => MasterClaim[];
  /** Live official claims map (master workspaces only). */
  claimsByPlayer: Map<string, MasterClaim[]>;
  /** Official roster player IDs for a master kind (live). */
  officialPlayerIds: (kind: MasterKind) => string[];
  /**
   * Official roster for a master. Uses the active workspace list when present,
   * otherwise hydrated player rows for claims outside this workspace.
   */
  officialPlayers: (kind: MasterKind, players: Player[]) => Player[];
  /** Live depth/sub cache for a master's canonical squad (read-only). */
  depthForMaster: (kind: MasterKind) => SquadDepthCache | undefined;
  otherMasterKinds: MasterKind[];
  /** All three master workspaces for this roster (when present). */
  masterWorkspacesList: Workspace[];
  masterLabel: (kind: MasterKind) => string;
  canonicalSquad: (kind: MasterKind) => SquadTeam;
  loading: boolean;
  /** Increments after each successful claims/depth refresh (incl. realtime). */
  claimsRevision: number;
  /** Pass `{ force: true }` to bypass the pending-outbox read gate (post-drain). */
  refresh: (opts?: { force?: boolean }) => Promise<void>;
  /** Export claims/depth for offline snapshot. */
  exportSnapshotSlice: () => MasterConflictSnapshotSlice;
  /** Restore claims/depth from offline snapshot. */
  hydrateFromSnapshot: (slice: MasterConflictSnapshotSlice) => void;
  /** Optimistic Live assign while offline (single-claim LWW). */
  applyOfflineAssign: (
    playerId: string,
    team: PlayerAssignment | null,
    player?: Player | null
  ) => void;
  /** Optimistic Live remove-from-one-team while offline. */
  applyOfflineRemoveFromTeam: (
    playerId: string,
    squadTeam: SquadTeam
  ) => void;
};

const MasterConflictContext = createContext<MasterConflictValue | null>(null);

export function MasterConflictProvider({ children }: { children: ReactNode }) {
  const {
    rosterId,
    workspaces,
    workspaceKind,
    loading: roleLoading,
    isAdminLiveMode,
  } = useActiveRole();
  const { isOnline, outboxReady, pendingCount, isSyncing } = useOffline();
  const [claimsByPlayer, setClaimsByPlayer] = useState<
    Map<string, MasterClaim[]>
  >(new Map());
  const [claimedPlayersById, setClaimedPlayersById] = useState<
    Map<string, Player>
  >(new Map());
  const [depthByKind, setDepthByKind] = useState<
    Partial<Record<MasterKind, SquadDepthCache>>
  >({});
  const [loading, setLoading] = useState(true);
  const [claimsRevision, setClaimsRevision] = useState(0);
  const masters = useMemo(() => masterWorkspaces(workspaces), [workspaces]);
  const masterIdsKey = masters
    .map((w) => w.id)
    .sort()
    .join(',');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;
  // Only block reads while unsynced local writes exist — not syncError/offline flags.
  const pendingLocalRef = useRef(false);
  pendingLocalRef.current = !outboxReady || pendingCount > 0 || isSyncing;

  const refresh = useCallback(async (opts?: { force?: boolean }) => {
    if (!isOnlineRef.current) {
      setLoading(false);
      return;
    }
    // Keep optimistic Live claims while outbox still has local edits.
    if (!opts?.force && pendingLocalRef.current) {
      setLoading(false);
      return;
    }
    if (masters.length === 0) {
      setClaimsByPlayer(new Map());
      setClaimedPlayersById(new Map());
      setDepthByKind({});
      setClaimsRevision((n) => n + 1);
      setLoading(false);
      return;
    }
    try {
      const next = await fetchMasterClaims(masters);
      setClaimsByPlayer(next);
      setClaimsRevision((n) => n + 1);
      const claimedIds = [...next.keys()];
      try {
        const [playersById, depthEntries] = await Promise.all([
          fetchPlayersByIds(claimedIds),
          Promise.all(
            masters.map(async (master) => {
              const kind = master.kind as MasterKind;
              const squad = canonicalSquadForMaster(kind);
              const [depth, subs] = await Promise.all([
                listDepthChartEntries(rosterId, squad, master.id),
                listSubOrderEntries(rosterId, squad, master.id),
              ]);
              return [kind, { depthEntries: depth, subEntries: subs }] as const;
            })
          ),
        ]);
        setClaimedPlayersById(playersById);
        const nextDepth: Partial<Record<MasterKind, SquadDepthCache>> = {};
        for (const [kind, cache] of depthEntries) {
          nextDepth[kind] = cache;
        }
        setDepthByKind(nextDepth);
      } catch {
        // Claims already applied; depth/hydration can lag without hiding moves.
      }
    } catch {
      // Keep last good map; surfaces still render without badges.
    } finally {
      setLoading(false);
    }
  }, [masters, rosterId]);

  useEffect(() => {
    if (roleLoading || !outboxReady) return;
    // Don't refetch/clear on connectivity flips — offline keeps last claims.
    if (!isOnlineRef.current) {
      setLoading(false);
      return;
    }
    if (pendingLocalRef.current) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
  }, [roleLoading, outboxReady, masterIdsKey, refresh, pendingCount, isSyncing]);

  useForegroundRefresh(
    Boolean(isOnline && outboxReady && masters.length > 0 && pendingCount === 0),
    () => {
      if (!isOnlineRef.current || pendingLocalRef.current) return;
      void refresh();
    },
    12_000
  );

  const [realtimeEpoch, setRealtimeEpoch] = useState(0);
  useEffect(() => {
    if (!isOnline || masters.length === 0) return;

    const topic = `master-conflicts:${masterIdsKey}:${Date.now()}`;
    let channel = supabase.channel(topic);

    const scheduleRefresh = () => {
      if (!isOnlineRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void refresh();
      }, 250);
    };

    for (const master of masters) {
      channel = channel
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'player_assignments',
            filter: `workspace_id=eq.${master.id}`,
          },
          scheduleRefresh
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'depth_chart_entries',
            filter: `workspace_id=eq.${master.id}`,
          },
          scheduleRefresh
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'sub_order_entries',
            filter: `workspace_id=eq.${master.id}`,
          },
          scheduleRefresh
        );
    }

    channel.subscribe((status) => {
      // Do not resubscribe on CLOSED — that fires on intentional teardown too.
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setRealtimeEpoch((n) => n + 1);
      }
    });

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void supabase.removeChannel(channel);
    };
  }, [masterIdsKey, masters, refresh, isOnline, realtimeEpoch]);

  const exportSnapshotSlice = useCallback((): MasterConflictSnapshotSlice => {
    return {
      claimsEntries: [...claimsByPlayer.entries()],
      claimedPlayers: [...claimedPlayersById.values()],
      depthByKind,
    };
  }, [claimsByPlayer, claimedPlayersById, depthByKind]);

  const hydrateFromSnapshot = useCallback(
    (slice: MasterConflictSnapshotSlice) => {
      setClaimsByPlayer(new Map(slice.claimsEntries));
      setClaimedPlayersById(
        new Map(slice.claimedPlayers.map((p) => [p.id, p]))
      );
      setDepthByKind(slice.depthByKind ?? {});
      setClaimsRevision((n) => n + 1);
      setLoading(false);
    },
    []
  );

  const applyOfflineAssign = useCallback(
    (
      playerId: string,
      team: PlayerAssignment | null,
      player?: Player | null
    ) => {
      setClaimsByPlayer((prev) => {
        const next = new Map(prev);
        if (team == null || team === UNAVAILABLE_POOL || !isSquadTeam(team)) {
          next.delete(playerId);
          return next;
        }
        const kind = masterKindForSquad(team);
        const master = masters.find((m) => m.kind === kind);
        if (!master) return prev;
        next.set(playerId, [
          {
            kind,
            workspaceId: master.id,
            squadTeam: team,
          },
        ]);
        return next;
      });
      if (player) {
        setClaimedPlayersById((prev) => {
          const next = new Map(prev);
          next.set(playerId, { ...player, squad_team: team });
          return next;
        });
      }
      setClaimsRevision((n) => n + 1);
    },
    [masters]
  );

  const applyOfflineRemoveFromTeam = useCallback(
    (playerId: string, squadTeam: SquadTeam) => {
      const kind = masterKindForSquad(squadTeam);
      setClaimsByPlayer((prev) => {
        const list = prev.get(playerId) ?? [];
        const remaining = list.filter((c) => c.kind !== kind);
        const next = new Map(prev);
        if (remaining.length === 0) next.delete(playerId);
        else next.set(playerId, remaining);
        return next;
      });
      setClaimsRevision((n) => n + 1);
    },
    []
  );

  const labelsFor = useCallback(
    (playerId: string) => {
      const claims = claimsByPlayer.get(playerId) ?? [];
      // Admin Live has no single active master — show every claiming team.
      if (isAdminLiveMode) {
        if (claims.length < 2) return [];
        return MASTER_KINDS.filter((kind) =>
          claims.some((c) => c.kind === kind)
        ).map(masterKindShortLabel);
      }
      return conflictLabelsForPlayer({
        claims,
        activeKind: workspaceKind,
      });
    },
    [claimsByPlayer, workspaceKind, isAdminLiveMode]
  );

  const availabilityTagsFor = useCallback(
    (playerId: string) =>
      otherMasterClaimTags({
        claims: claimsByPlayer.get(playerId) ?? [],
        activeKind: isAdminLiveMode ? null : workspaceKind,
      }),
    [claimsByPlayer, workspaceKind, isAdminLiveMode]
  );

  const isUnclaimed = useCallback(
    (playerId: string) =>
      isGloballyUnclaimed(claimsByPlayer.get(playerId) ?? []),
    [claimsByPlayer]
  );

  const claimsFor = useCallback(
    (playerId: string) => claimsByPlayer.get(playerId) ?? [],
    [claimsByPlayer]
  );

  const officialPlayerIds = useCallback(
    (kind: MasterKind) =>
      claimsForMaster(claimsByPlayer, kind).map((r) => r.playerId),
    [claimsByPlayer]
  );

  const officialPlayers = useCallback(
    (kind: MasterKind, players: Player[]) => {
      const ids = officialPlayerIds(kind);
      const workspaceById = new Map(players.map((p) => [p.id, p]));
      return ids
        .map(
          (id) => workspaceById.get(id) ?? claimedPlayersById.get(id) ?? null
        )
        .filter((p): p is Player => Boolean(p))
        .sort((a, b) => {
          const ln = a.last_name.localeCompare(b.last_name);
          if (ln !== 0) return ln;
          return a.first_name.localeCompare(b.first_name);
        });
    },
    [officialPlayerIds, claimedPlayersById]
  );

  const otherKinds = useMemo((): MasterKind[] => {
    if (!workspaceKind || !isMasterKind(workspaceKind)) return [];
    return (['master_varsity', 'master_jv', 'master_fr_soph'] as MasterKind[]).filter(
      (k) => k !== workspaceKind
    );
  }, [workspaceKind]);

  const depthForMaster = useCallback(
    (kind: MasterKind) => depthByKind[kind],
    [depthByKind]
  );

  const value = useMemo(
    () => ({
      labelsFor,
      availabilityTagsFor,
      isGloballyUnclaimed: isUnclaimed,
      claimsFor,
      claimsByPlayer,
      officialPlayerIds,
      officialPlayers,
      depthForMaster,
      otherMasterKinds: otherKinds,
      masterWorkspacesList: masters,
      masterLabel: masterKindShortLabel,
      canonicalSquad: canonicalSquadForMaster,
      loading,
      claimsRevision,
      refresh,
      exportSnapshotSlice,
      hydrateFromSnapshot,
      applyOfflineAssign,
      applyOfflineRemoveFromTeam,
    }),
    [
      labelsFor,
      availabilityTagsFor,
      isUnclaimed,
      claimsFor,
      claimsByPlayer,
      officialPlayerIds,
      officialPlayers,
      depthForMaster,
      otherKinds,
      masters,
      loading,
      claimsRevision,
      refresh,
      exportSnapshotSlice,
      hydrateFromSnapshot,
      applyOfflineAssign,
      applyOfflineRemoveFromTeam,
    ]
  );

  return (
    <MasterConflictContext.Provider value={value}>
      {children}
    </MasterConflictContext.Provider>
  );
}

export function useMasterConflicts(): MasterConflictValue {
  const ctx = useContext(MasterConflictContext);
  if (!ctx) {
    throw new Error(
      'useMasterConflicts must be used within MasterConflictProvider'
    );
  }
  return ctx;
}
