import type { MasterClaim, MasterKind } from '@/lib/masterConflicts';
import type { RankPool } from '@/lib/assignPools';
import type { AvailableRankPlan, GradeFilter } from '@/lib/availableRank';
import type { DepthCacheMap, SquadDepthCache } from '@/lib/squadSections';
import type {
  Player,
  PlayerAssignment,
  PlayerInput,
  Roster,
  SquadTeam,
} from '@/lib/types';

/** Offline scope is roster-only after shared-workspace cutover. */
export type OfflineScope = {
  rosterId: string;
  /** Shared workspace id (for replay writes); not part of storage key. */
  workspaceId: string;
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
      /** Absolute post-move order for the position group (replay). */
      orderedPlayerIds?: string[];
    }
  | {
      type: 'setStarter';
      squadTeam: SquadTeam;
      positionNumber: number;
      slotIndex: number;
      playerId: string;
      outgoingPlayerId?: string | null;
      incomingSubIndex?: number | null;
      /** Absolute post-swap bench order at edit time (required for correct replay). */
      desiredSubIds?: string[];
      nextPositions?: number[];
      needsTeamMove?: boolean;
      liveNeedsAssign?: boolean;
      needsPosition?: boolean;
    }
  | {
      type: 'moveSub';
      squadTeam: SquadTeam;
      playerId: string;
      direction: 'up' | 'down';
      /** Absolute post-move bench order (replay). */
      orderedPlayerIds?: string[];
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
      /** Normalize contiguous Available/Unavailable ranks (load-time ensure). */
      type: 'syncAvailableRanks';
      pool: RankPool;
      ranks: AvailableRankPlan[];
    }
  | {
      /** Legacy Live op; replayed as assignSquad(null). */
      type: 'adminLiveRemoveFromTeam';
      playerId: string;
      squadTeam: SquadTeam;
    }
  | {
      type: 'upsertTryoutDay';
      playerId: string;
      day: number;
      tryoutNumber?: number | null;
      attended?: boolean;
      /** When setting a number, prepopulate later null days through this count. */
      dayCount?: number;
    };

export type OfflineOp = OfflineOpBase & OfflineOpBody;

/** Op payload before id/at are assigned. */
export type OfflineOpInput = OfflineOpBody;

/**
 * Serializable snapshot for offline boot + crash recovery.
 * version 2 invalidates pre-shared-workspace caches (v1 keys ignored).
 */
export type RosterSnapshot = {
  version: 2;
  scope: OfflineScope;
  savedAt: number;
  roster: Roster | null;
  players: Player[];
  depthCache: DepthCacheMap;
  /** Kept for hydrate API compatibility; always empty under shared workspace. */
  claimsEntries: [string, MasterClaim[]][];
  claimedPlayers: Player[];
  depthByKind: Partial<Record<MasterKind, SquadDepthCache>>;
};

/** Storage key is roster-only so personal/live overlays cannot collide. */
export function scopeKey(scope: OfflineScope): string {
  return scope.rosterId;
}

export function newOpId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
