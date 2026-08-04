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
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useActiveRole } from '@/lib/ActiveRoleContext';
import { useAuth } from '@/lib/AuthContext';
import {
  copyRosterFromSnapshot,
  defaultOfflineCopyName,
} from '@/lib/copyRoster';
import { useIsOnline } from '@/lib/offline/connectivity';
import { clearOfflineCacheForRoster } from '@/lib/offline/clearRosterCache';
import {
  enqueueOutboxOp,
  loadOutbox,
  shiftOutbox,
  clearOutbox,
} from '@/lib/offline/outbox';
import { loadRosterSnapshot } from '@/lib/offline/snapshot';
import {
  newOpId,
  type OfflineOp,
  type OfflineOpInput,
  type OfflineScope,
  type RosterSnapshot,
} from '@/lib/offline/types';

type ReplayFn = (op: OfflineOp) => Promise<void>;
type DrainCompleteFn = () => Promise<void>;

export type OfflineConflictChoice =
  | 'keep_device'
  | 'use_supabase'
  | 'use_supabase_and_copy';

type ConflictHandlers = {
  getSnapshot: () => Promise<RosterSnapshot | null>;
  getRosterName: () => string;
  discardLocalAndPull: () => Promise<void>;
};

const MAX_AUTO_RETRIES = 5;
const RECONNECT_DRAIN_DELAY_MS = 1000;
const OP_TIMEOUT_MS = 12_000;
const REFRESH_TIMEOUT_MS = 15_000;

function retryDelayMs(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, 12_000);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

type OfflineValue = {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  syncError: string | null;
  scope: OfflineScope | null;
  outboxReady: boolean;
  shouldQueueWrites: boolean;
  offlineReady: boolean;
  setOfflineReady: (ready: boolean) => void;
  clearSyncError: () => void;
  enqueue: (op: OfflineOpInput) => Promise<void>;
  registerReplay: (fn: ReplayFn | null) => void;
  registerDrainComplete: (fn: DrainCompleteFn | null) => void;
  registerConflictHandlers: (handlers: ConflictHandlers | null) => void;
  retrySync: () => void;
  refreshPendingCount: () => Promise<void>;
  /** True when user must choose Keep / Supabase / copy before drain. */
  conflictVisible: boolean;
  conflictRosterName: string;
  conflictBusy: boolean;
  conflictError: string | null;
  resolveConflict: (choice: OfflineConflictChoice) => Promise<void>;
};

const OfflineContext = createContext<OfflineValue | null>(null);

export function OfflineProvider({ children }: { children: ReactNode }) {
  const {
    rosterId,
    activeWorkspaceId,
    loading: roleLoading,
  } = useActiveRole();
  const { user } = useAuth();
  const isOnline = useIsOnline();
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [outboxReady, setOutboxReady] = useState(false);
  const [drainNonce, setDrainNonce] = useState(0);
  const [conflictVisible, setConflictVisible] = useState(false);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [conflictRosterName, setConflictRosterName] = useState('');

  const replayRef = useRef<ReplayFn | null>(null);
  const drainCompleteRef = useRef<DrainCompleteFn | null>(null);
  const conflictHandlersRef = useRef<ConflictHandlers | null>(null);
  const drainingRef = useRef(false);
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;
  const roleLoadingRef = useRef(roleLoading);
  roleLoadingRef.current = roleLoading;
  const wasOnlineRef = useRef(isOnline);
  const autoRetryAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** After user resolves conflict for this scope, auto-drain is allowed. */
  const conflictResolvedScopeRef = useRef<string | null>(null);
  const awaitingConflictRef = useRef(false);

  // Outbox/snapshot keys are rosterId-only; allow scope before workspace resolves
  // so the UI can hydrate instantly on iPad navigation.
  const scope = useMemo((): OfflineScope | null => {
    if (!rosterId) return null;
    return {
      rosterId,
      workspaceId: activeWorkspaceId ?? '',
    };
  }, [rosterId, activeWorkspaceId]);

  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const writeReady = Boolean(activeWorkspaceId);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const refreshPendingCount = useCallback(async () => {
    const s = scopeRef.current;
    if (!s) {
      setPendingCount(0);
      return;
    }
    const ops = await loadOutbox(s);
    setPendingCount(ops.length);
  }, []);

  const scopeRosterId = scope?.rosterId ?? null;

  useEffect(() => {
    if (!scopeRosterId) {
      setOutboxReady(false);
      setPendingCount(0);
      setConflictVisible(false);
      awaitingConflictRef.current = false;
      return;
    }
    let active = true;
    // Load by roster id only — workspace id is not part of the storage key.
    void loadOutbox({ rosterId: scopeRosterId, workspaceId: '' }).then(
      (ops) => {
        if (!active) return;
        setPendingCount(ops.length);
        setOutboxReady(true);
      }
    );
    return () => {
      active = false;
    };
  }, [scopeRosterId]);

  // Reset conflict resolution when switching rosters.
  useEffect(() => {
    conflictResolvedScopeRef.current = null;
    awaitingConflictRef.current = false;
    setConflictVisible(false);
    setConflictError(null);
  }, [rosterId]);

  const enqueue = useCallback(async (op: OfflineOpInput) => {
    const s = scopeRef.current;
    if (!s?.rosterId) throw new Error('No offline scope');
    if (!s.workspaceId) throw new Error('Workspace not ready');
    const full: OfflineOp = {
      ...op,
      id: newOpId(),
      at: Date.now(),
    };
    const next = await enqueueOutboxOp(s, full);
    setPendingCount(next.length);
  }, []);

  const scheduleAutoRetry = useCallback(
    (reason?: string) => {
      clearRetryTimer();
      setIsSyncing(false);
      if (!isOnlineRef.current) return false;
      // Don't auto-retry while conflict UI is up.
      if (awaitingConflictRef.current) return false;
      const attempt = autoRetryAttemptRef.current;
      if (attempt >= MAX_AUTO_RETRIES) {
        setSyncError(reason ?? 'Failed to sync offline changes');
        return false;
      }
      const delay = retryDelayMs(attempt);
      autoRetryAttemptRef.current = attempt + 1;
      setSyncError(null);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        setDrainNonce((n) => n + 1);
      }, delay);
      return true;
    },
    [clearRetryTimer]
  );

  const drain = useCallback(async () => {
    const s = scopeRef.current;
    if (!s || roleLoadingRef.current || drainingRef.current) return;
    if (!isOnlineRef.current) return;
    if (awaitingConflictRef.current) return;

    const replay = replayRef.current;
    if (!replay) {
      scheduleAutoRetry('Sync not ready yet');
      return;
    }

    let initial: OfflineOp[];
    try {
      initial = await withTimeout(loadOutbox(s), 5000, 'Load outbox');
    } catch {
      scheduleAutoRetry('Could not read offline queue');
      return;
    }

    if (initial.length === 0) {
      setPendingCount(0);
      autoRetryAttemptRef.current = 0;
      clearRetryTimer();
      setSyncError(null);
      setIsSyncing(false);
      return;
    }

    drainingRef.current = true;
    setIsSyncing(true);
    setSyncError(null);
    let wroteOps = false;
    let drainFailed = false;
    try {
      while (isOnlineRef.current) {
        const ops = await loadOutbox(s);
        setPendingCount(ops.length);
        if (ops.length === 0) break;
        const head = ops[0];
        await withTimeout(replay(head), OP_TIMEOUT_MS, `Sync ${head.type}`);
        const remaining = await shiftOutbox(s);
        setPendingCount(remaining.length);
        wroteOps = true;
      }
      if (!isOnlineRef.current) {
        throw new Error('Went offline while syncing');
      }
      autoRetryAttemptRef.current = 0;
      clearRetryTimer();
      setSyncError(null);
    } catch (e) {
      drainFailed = true;
      const message =
        e instanceof Error ? e.message : 'Failed to sync offline changes';
      if (!scheduleAutoRetry(message)) {
        setSyncError(message);
      }
    } finally {
      drainingRef.current = false;
      setIsSyncing(false);
      await refreshPendingCount();
    }

    if (wroteOps && !drainFailed && isOnlineRef.current) {
      const complete = drainCompleteRef.current;
      if (complete) {
        try {
          await withTimeout(complete(), REFRESH_TIMEOUT_MS, 'Refresh after sync');
        } catch {
          // Ops already landed; next poll/focus reconcile will catch up.
        }
      }
    }
  }, [refreshPendingCount, scheduleAutoRetry, clearRetryTimer]);

  const openConflictIfNeeded = useCallback(async (): Promise<boolean> => {
    const s = scopeRef.current;
    if (!s || !isOnlineRef.current) return false;
    if (conflictResolvedScopeRef.current === s.rosterId) return false;

    const ops = await loadOutbox(s);
    if (ops.length === 0) {
      setPendingCount(0);
      return false;
    }
    setPendingCount(ops.length);
    const handlers = conflictHandlersRef.current;
    setConflictRosterName(handlers?.getRosterName() ?? 'This team');
    awaitingConflictRef.current = true;
    setConflictVisible(true);
    setConflictError(null);
    return true;
  }, []);

  const resolveConflict = useCallback(
    async (choice: OfflineConflictChoice) => {
      const s = scopeRef.current;
      if (!s || !user) return;
      const handlers = conflictHandlersRef.current;
      setConflictBusy(true);
      setConflictError(null);
      try {
        if (choice === 'keep_device') {
          conflictResolvedScopeRef.current = s.rosterId;
          awaitingConflictRef.current = false;
          setConflictVisible(false);
          await drain();
          return;
        }

        if (choice === 'use_supabase_and_copy') {
          let snapshot =
            (await handlers?.getSnapshot()) ?? (await loadRosterSnapshot(s));
          if (!snapshot || snapshot.players.length === 0) {
            throw new Error(
              'No offline snapshot to copy. Choose Keep device or Use Supabase.'
            );
          }
          const name = defaultOfflineCopyName(
            snapshot.roster?.name ?? handlers?.getRosterName() ?? 'Team'
          );
          await copyRosterFromSnapshot({
            snapshot,
            newName: name,
            ownerUserId: user.id,
          });
        }

        // Discard local outbox + pull server for original team.
        await clearOutbox(s);
        setPendingCount(0);
        if (handlers?.discardLocalAndPull) {
          await handlers.discardLocalAndPull();
        } else {
          await clearOfflineCacheForRoster(s.rosterId);
        }
        conflictResolvedScopeRef.current = s.rosterId;
        awaitingConflictRef.current = false;
        setConflictVisible(false);
        autoRetryAttemptRef.current = 0;
        setSyncError(null);
      } catch (e) {
        setConflictError(
          e instanceof Error ? e.message : 'Failed to resolve offline conflict'
        );
      } finally {
        setConflictBusy(false);
      }
    },
    [user, drain]
  );

  const retrySync = useCallback(() => {
    clearRetryTimer();
    autoRetryAttemptRef.current = 0;
    setSyncError(null);
    setIsSyncing(false);
    // Manual retry after a failed drain (post-conflict) — allow drain.
    if (conflictResolvedScopeRef.current === scopeRef.current?.rosterId) {
      setDrainNonce((n) => n + 1);
      return;
    }
    // If conflict not resolved yet, re-open / nudge.
    void openConflictIfNeeded().then((opened) => {
      if (!opened) setDrainNonce((n) => n + 1);
    });
  }, [clearRetryTimer, openConflictIfNeeded]);

  const registerReplay = useCallback((fn: ReplayFn | null) => {
    replayRef.current = fn;
    if (fn && isOnlineRef.current) {
      setDrainNonce((n) => n + 1);
    }
  }, []);

  const registerDrainComplete = useCallback((fn: DrainCompleteFn | null) => {
    drainCompleteRef.current = fn;
  }, []);

  const registerConflictHandlers = useCallback(
    (handlers: ConflictHandlers | null) => {
      conflictHandlersRef.current = handlers;
    },
    []
  );

  // Auto-drain when back online — unless pending ops need a conflict decision.
  useEffect(() => {
    if (roleLoading || !scope || !writeReady || !isOnline || !outboxReady) {
      wasOnlineRef.current = isOnline;
      if (!isOnline) {
        clearRetryTimer();
        autoRetryAttemptRef.current = 0;
        drainingRef.current = false;
        setIsSyncing(false);
      }
      return;
    }

    const comingOnline = !wasOnlineRef.current;
    wasOnlineRef.current = true;
    const delay = comingOnline ? RECONNECT_DRAIN_DELAY_MS : 0;
    const t = setTimeout(() => {
      void (async () => {
        if (awaitingConflictRef.current) return;
        if (conflictResolvedScopeRef.current !== scope.rosterId) {
          const opened = await openConflictIfNeeded();
          if (opened) return;
        }
        await drain();
      })();
    }, delay);
    return () => clearTimeout(t);
  }, [
    roleLoading,
    scope,
    writeReady,
    isOnline,
    outboxReady,
    drainNonce,
    drain,
    clearRetryTimer,
    openConflictIfNeeded,
  ]);

  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next !== 'active') return;
      void NetInfo.fetch().then((state) => {
        if (state.isConnected === false) return;
        autoRetryAttemptRef.current = 0;
        setDrainNonce((n) => n + 1);
      });
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!isOnline || roleLoading || pendingCount === 0 || isSyncing) return;
    if (syncError) return;
    if (retryTimerRef.current) return;
    if (awaitingConflictRef.current) return;
    if (conflictResolvedScopeRef.current !== scope?.rosterId) return;
    const t = setTimeout(() => {
      setDrainNonce((n) => n + 1);
    }, 2000);
    return () => clearTimeout(t);
  }, [isOnline, roleLoading, pendingCount, isSyncing, syncError, scope]);

  useEffect(() => () => clearRetryTimer(), [clearRetryTimer]);

  const shouldQueueWrites =
    !isOnline ||
    isSyncing ||
    pendingCount > 0 ||
    Boolean(syncError) ||
    conflictVisible;

  const value = useMemo<OfflineValue>(
    () => ({
      isOnline,
      isSyncing,
      pendingCount,
      syncError,
      scope,
      outboxReady,
      shouldQueueWrites,
      offlineReady,
      setOfflineReady,
      clearSyncError: () => setSyncError(null),
      enqueue,
      registerReplay,
      registerDrainComplete,
      registerConflictHandlers,
      retrySync,
      refreshPendingCount,
      conflictVisible,
      conflictRosterName,
      conflictBusy,
      conflictError,
      resolveConflict,
    }),
    [
      isOnline,
      isSyncing,
      pendingCount,
      syncError,
      scope,
      outboxReady,
      shouldQueueWrites,
      offlineReady,
      enqueue,
      registerReplay,
      registerDrainComplete,
      registerConflictHandlers,
      retrySync,
      refreshPendingCount,
      conflictVisible,
      conflictRosterName,
      conflictBusy,
      conflictError,
      resolveConflict,
    ]
  );

  return (
    <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
  );
}

export function useOffline(): OfflineValue {
  const ctx = useContext(OfflineContext);
  if (!ctx) {
    throw new Error('useOffline must be used within OfflineProvider');
  }
  return ctx;
}

export function useOfflineOptional(): OfflineValue | null {
  return useContext(OfflineContext);
}
