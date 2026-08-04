import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import type { MasterClaim, MasterKind } from '@/lib/masterConflicts';
import {
  canonicalSquadForMaster,
  masterKindShortLabel,
} from '@/lib/masterConflicts';
import type { SquadDepthCache } from '@/lib/squadSections';
import type { Player, PlayerAssignment, SquadTeam, Workspace } from '@/lib/types';

/**
 * Stubbed after single shared workspace: cross-master conflicts no longer exist.
 * Kept so layout/offline snapshot APIs stay stable without multi-master fetches.
 */
export type MasterConflictSnapshotSlice = {
  claimsEntries: [string, MasterClaim[]][];
  claimedPlayers: Player[];
  depthByKind: Partial<Record<MasterKind, SquadDepthCache>>;
};

type MasterConflictValue = {
  labelsFor: (playerId: string) => string[];
  availabilityTagsFor: (playerId: string) => string[];
  isGloballyUnclaimed: (playerId: string) => boolean;
  claimsFor: (playerId: string) => MasterClaim[];
  claimsByPlayer: Map<string, MasterClaim[]>;
  officialPlayerIds: (kind: MasterKind) => string[];
  officialPlayers: (kind: MasterKind, players: Player[]) => Player[];
  depthForMaster: (kind: MasterKind) => SquadDepthCache | undefined;
  otherMasterKinds: MasterKind[];
  masterWorkspacesList: Workspace[];
  masterLabel: (kind: MasterKind) => string;
  canonicalSquad: (kind: MasterKind) => SquadTeam;
  loading: boolean;
  claimsRevision: number;
  refresh: (opts?: { force?: boolean }) => Promise<void>;
  exportSnapshotSlice: () => MasterConflictSnapshotSlice;
  hydrateFromSnapshot: (slice: MasterConflictSnapshotSlice) => void;
  applyOfflineAssign: (
    playerId: string,
    team: PlayerAssignment | null,
    player?: Player | null
  ) => void;
  applyOfflineRemoveFromTeam: (
    playerId: string,
    squadTeam: SquadTeam
  ) => void;
};

const emptyClaims = new Map<string, MasterClaim[]>();

const MasterConflictContext = createContext<MasterConflictValue | null>(null);

export function MasterConflictProvider({ children }: { children: ReactNode }) {
  const exportSnapshotSlice = useCallback((): MasterConflictSnapshotSlice => {
    return {
      claimsEntries: [],
      claimedPlayers: [],
      depthByKind: {},
    };
  }, []);

  const hydrateFromSnapshot = useCallback(
    (_slice: MasterConflictSnapshotSlice) => {
      // no-op: shared workspace has no cross-master claims
    },
    []
  );

  const refresh = useCallback(async (_opts?: { force?: boolean }) => {}, []);

  const value = useMemo<MasterConflictValue>(
    () => ({
      labelsFor: () => [],
      availabilityTagsFor: () => [],
      isGloballyUnclaimed: () => true,
      claimsFor: () => [],
      claimsByPlayer: emptyClaims,
      officialPlayerIds: () => [],
      officialPlayers: (_kind, players) => players,
      depthForMaster: () => undefined,
      otherMasterKinds: [],
      masterWorkspacesList: [],
      masterLabel: masterKindShortLabel,
      canonicalSquad: canonicalSquadForMaster,
      loading: false,
      claimsRevision: 0,
      refresh,
      exportSnapshotSlice,
      hydrateFromSnapshot,
      applyOfflineAssign: () => {},
      applyOfflineRemoveFromTeam: () => {},
    }),
    [exportSnapshotSlice, hydrateFromSnapshot, refresh]
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
