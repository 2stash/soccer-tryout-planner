import type { MasterClaim, MasterKind } from '@/lib/masterConflicts';
import type { RankPool } from '@/lib/assignPools';
import type { GradeFilter } from '@/lib/availableRank';
import type { DepthCacheMap, SquadDepthCache } from '@/lib/squadSections';
import type {
  Player,
  PlayerAssignment,
  PlayerInput,
  Roster,
  SquadTeam,
} from '@/lib/types';
import type { AdminEditMode } from '@/lib/ActiveRoleContext';

export type OfflineScope = {
  rosterId: string;
  workspaceId: string;
  adminEditMode: AdminEditMode;
};

export type OfflineOpBase = {
  id: string;
  at: number;
};

type OfflineOpBody =
  | {
      type: 'assignSquad';
      playerId: string;
      team: PlayerAssignment | null;
    }
  | {
      type: 'savePlayer';
      playerId: string;
      input: PlayerInput;
    }
  | {
      type: 'removePlayer';
      playerId: string;
    }
  | {
      type: 'changePositions';
      playerId: string;
      positions: number[];
    }
  | {
      type: 'moveDepth';
      squadTeam: SquadTeam;
      positionNumber: number;
      playerId: string;
      direction: 'up' | 'down';
    }
  | {
      type: 'setStarter';
      squadTeam: SquadTeam;
      positionNumber: number;
      slotIndex: number;
      playerId: string;
      outgoingPlayerId?: string | null;
      incomingSubIndex?: number | null;
    }
  | {
      type: 'moveSub';
      squadTeam: SquadTeam;
      playerId: string;
      direction: 'up' | 'down';
    }
  | {
      type: 'moveAvailable';
      playerId: string;
      direction: 'up' | 'down';
      grade?: GradeFilter;
      pool?: RankPool;
    }
  | {
      type: 'toggleAvailablePin';
      playerId: string;
      grade?: GradeFilter;
      pool?: RankPool;
    }
  | {
      type: 'moveAvailableToTop';
      playerId: string;
      grade?: GradeFilter;
      pool?: RankPool;
    }
  | {
      type: 'moveAvailableToBottom';
      playerId: string;
      grade?: GradeFilter;
      pool?: RankPool;
    }
  | {
      type: 'resetAvailableOrder';
      pool?: RankPool;
    }
  | {
      type: 'adminLiveRemoveFromTeam';
      playerId: string;
      squadTeam: SquadTeam;
    };

export type OfflineOp = OfflineOpBase & OfflineOpBody;

/** Op payload before id/at are assigned. */
export type OfflineOpInput = OfflineOpBody;

/** Serializable snapshot for offline boot + crash recovery. */
export type RosterSnapshot = {
  version: 1;
  scope: OfflineScope;
  savedAt: number;
  roster: Roster | null;
  players: Player[];
  depthCache: DepthCacheMap;
  /** Serialized Map entries for live claims. */
  claimsEntries: [string, MasterClaim[]][];
  claimedPlayers: Player[];
  depthByKind: Partial<Record<MasterKind, SquadDepthCache>>;
};

export function scopeKey(scope: OfflineScope): string {
  return `${scope.rosterId}:${scope.workspaceId}:${scope.adminEditMode}`;
}

export function newOpId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
