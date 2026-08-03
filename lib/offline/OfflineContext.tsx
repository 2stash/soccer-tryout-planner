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
import { useIsOnline } from '@/lib/offline/connectivity';
import {
  enqueueOutboxOp,
  loadOutbox,
  shiftOutbox,
} from '@/lib/offline/outbox';
import {
  newOpId,
  type OfflineOp,
  type OfflineOpInput,
  type OfflineScope,
} from '@/lib/offline/types';

type ReplayFn = (op: OfflineOp) => Promise<void>;
type DrainCompleteFn = () => Promise<void>;

const MAX_AUTO_RETRIES = 5;
/** Wait for radio after airplane mode before first attempt. */
const RECONNECT_DRAIN_DELAY_MS = 1000;
/** Hung Supabase calls after reconnect must not pin Syncing forever. */
const OP_TIMEOUT_MS = 12_000;
const REFRESH_TIMEOUT_MS = 15_000;

function retryDelayMs(attemptIndex: number): number {
  // 1s, 2s, 4s, 8s, 12s
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
  /** True after the first outbox load for the current scope. */
  outboxReady: boolean;
  /** True when writes should go to the outbox (offline or queue draining). */
  shouldQueueWrites: boolean;
  /** True when core tryout editing is allowed offline (snapshot was loaded or online). */
  offlineReady: boolean;
  setOfflineReady: (ready: boolean) => void;
  clearSyncError: () => void;
  enqueue: (op: OfflineOpInput) => Promise<void>;
  registerReplay: (fn: ReplayFn | null) => void;
  registerDrainComplete: (fn: DrainCompleteFn | null) => void;
  retrySync: () => void;
  refreshPendingCount: () => Promise<void>;
};

const OfflineContext = createContext<OfflineValue | null>(null);

export function OfflineProvider({ children }: { children: ReactNode }) {
  const {
    rosterId,
    activeWorkspaceId,
    adminEditMode,
    loading: roleLoading,
  } = useActiveRole();
  const isOnline = useIsOnline();
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [outboxReady, setOutboxReady] = useState(false);
  const [drainNonce, setDrainNonce] = useState(0);

  const replayRef = useRef<ReplayFn | null>(null);
  const drainCompleteRef = useRef<DrainCompleteFn | null>(null);
  const drainingRef = useRef(false);
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;
  const roleLoadingRef = useRef(roleLoading);
  roleLoadingRef.current = roleLoading;
  const wasOnlineRef = useRef(isOnline);
  const autoRetryAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scope = useMemo((): OfflineScope | null => {
    if (!rosterId || !activeWorkspaceId) return null;
    return {
      rosterId,
      workspaceId: activeWorkspaceId,
      adminEditMode,
    };
  }, [rosterId, activeWorkspaceId, adminEditMode]);

  const scopeRef = useRef(scope);
  scopeRef.current = scope;

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

  useEffect(() => {
    if (roleLoading || !scope) {
      setOutboxReady(false);
      setPendingCount(0);
      return;
    }
    let active = true;
    setOutboxReady(false);
    void loadOutbox(scope).then((ops) => {
      if (!active) return;
      setPendingCount(ops.length);
      setOutboxReady(true);
    });
    return () => {
      active = false;
    };
  }, [roleLoading, scope]);

  const enqueue = useCallback(async (op: OfflineOpInput) => {
    const s = scopeRef.current;
    if (!s) throw new Error('No offline scope');
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
      // Never leave Syncing stuck during the wait — banner shows pending count.
      setIsSyncing(false);
      if (!isOnlineRef.current) return false;
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

    // After a successful write drain, force-reconcile (RosterData drainComplete).
    // Do NOT flip isSyncing here: that gated remote pulls/claims and hid desktop edits.
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

  const retrySync = useCallback(() => {
    clearRetryTimer();
    autoRetryAttemptRef.current = 0;
    setSyncError(null);
    setIsSyncing(false);
    setDrainNonce((n) => n + 1);
  }, [clearRetryTimer]);

  const registerReplay = useCallback((fn: ReplayFn | null) => {
    replayRef.current = fn;
    if (fn && isOnlineRef.current) {
      setDrainNonce((n) => n + 1);
    }
  }, []);

  const registerDrainComplete = useCallback((fn: DrainCompleteFn | null) => {
    drainCompleteRef.current = fn;
  }, []);

  // Auto-drain when back online, scope ready, or retry requested.
  useEffect(() => {
    if (roleLoading || !scope || !isOnline) {
      wasOnlineRef.current = isOnline;
      clearRetryTimer();
      autoRetryAttemptRef.current = 0;
      drainingRef.current = false;
      setIsSyncing(false);
      return;
    }

    const comingOnline = !wasOnlineRef.current;
    wasOnlineRef.current = true;
    const delay = comingOnline ? RECONNECT_DRAIN_DELAY_MS : 0;
    const t = setTimeout(() => {
      void drain();
    }, delay);
    return () => clearTimeout(t);
  }, [roleLoading, scope, isOnline, drainNonce, drain, clearRetryTimer]);

  // App resume: re-check network and kick drain (iPad Settings → back).
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

  // Pending ops online but idle (and not mid-retry wait) → nudge drain.
  useEffect(() => {
    if (!isOnline || roleLoading || pendingCount === 0 || isSyncing) return;
    if (syncError) return;
    if (retryTimerRef.current) return;
    const t = setTimeout(() => {
      setDrainNonce((n) => n + 1);
    }, 2000);
    return () => clearTimeout(t);
  }, [isOnline, roleLoading, pendingCount, isSyncing, syncError]);

  useEffect(() => () => clearRetryTimer(), [clearRetryTimer]);

  const shouldQueueWrites =
    !isOnline || isSyncing || pendingCount > 0 || Boolean(syncError);

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
      retrySync,
      refreshPendingCount,
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
      retrySync,
      refreshPendingCount,
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

/** Optional: null when outside provider (e.g. dashboard). */
export function useOfflineOptional(): OfflineValue | null {
  return useContext(OfflineContext);
}
