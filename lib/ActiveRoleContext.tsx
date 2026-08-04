import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/lib/AuthContext';
import {
  listMyRolesOnRoster,
  pickDefaultActiveRole,
  roleLabel,
} from '@/lib/rosterMembers';
import type { RosterRole, Workspace, WorkspaceKind } from '@/lib/types';
import {
  getSharedWorkspace,
  listAndEnsureSharedWorkspace,
} from '@/lib/workspaces';

/** Kept for offline scope typing; always 'personal' after shared-workspace simplify. */
export type AdminEditMode = 'personal' | 'live';

type ActiveRoleValue = {
  rosterId: string;
  roles: RosterRole[];
  activeRole: RosterRole | null;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  activeWorkspaceId: string | null;
  workspaceKind: WorkspaceKind | null;
  canEditActiveWorkspace: boolean;
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
  /** Stub: always 'personal' (shared workspace; no admin live overlay). */
  adminEditMode: AdminEditMode;
  /** Stub: always false. */
  isAdminLiveMode: boolean;
  setActiveRole: (role: RosterRole) => void;
  /** Stub: no-op. */
  setAdminEditMode: (mode: AdminEditMode) => void;
  refreshRoles: () => Promise<void>;
  roleLabel: (role: RosterRole) => string;
  workspaceLabel: string;
};

const ActiveRoleContext = createContext<ActiveRoleValue | null>(null);

function storageKey(rosterId: string, userId: string) {
  return `activeRole:${rosterId}:${userId}`;
}

export function ActiveRoleProvider({
  rosterId,
  children,
}: {
  rosterId: string;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const [roles, setRoles] = useState<RosterRole[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeRole, setActiveRoleState] = useState<RosterRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshRoles = useCallback(async () => {
    if (!user) {
      setRoles([]);
      setWorkspaces([]);
      setActiveRoleState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [nextRoles, nextWorkspaces] = await Promise.all([
        listMyRolesOnRoster(rosterId, user.id),
        listAndEnsureSharedWorkspace(rosterId),
      ]);
      setRoles(nextRoles);
      setWorkspaces(nextWorkspaces);

      const stored = await AsyncStorage.getItem(storageKey(rosterId, user.id));
      const storedRole = stored as RosterRole | null;
      if (storedRole && nextRoles.includes(storedRole)) {
        setActiveRoleState(storedRole);
      } else if (nextRoles.length > 0) {
        const fallback = pickDefaultActiveRole(nextRoles);
        setActiveRoleState(fallback);
        await AsyncStorage.setItem(storageKey(rosterId, user.id), fallback);
      } else {
        setActiveRoleState(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load roles');
      setRoles([]);
      setWorkspaces([]);
      setActiveRoleState(null);
    } finally {
      setLoading(false);
    }
  }, [rosterId, user]);

  // Drop prior team's roles/workspaces immediately so network loads never use
  // a stale workspace id while the new roster's roles are in flight.
  useEffect(() => {
    setRoles([]);
    setWorkspaces([]);
    setActiveRoleState(null);
    setError(null);
    setLoading(true);
    void refreshRoles();
  }, [rosterId, refreshRoles]);

  const setActiveRole = useCallback(
    (role: RosterRole) => {
      if (!roles.includes(role) || !user) return;
      setActiveRoleState(role);
      void AsyncStorage.setItem(storageKey(rosterId, user.id), role);
    },
    [roles, rosterId, user]
  );

  const setAdminEditMode = useCallback((_mode: AdminEditMode) => {
    // No-op: shared workspace has no personal/live admin modes.
  }, []);

  const activeWorkspace = useMemo(
    () => getSharedWorkspace(workspaces),
    [workspaces]
  );

  const workspaceKind: WorkspaceKind | null = activeWorkspace?.kind ?? null;

  const canEditActiveWorkspace =
    activeWorkspace != null && roles.length > 0;

  const isAdmin = roles.includes('admin');
  const adminEditMode: AdminEditMode = 'personal';
  const isAdminLiveMode = false;

  const workspaceLabel = useMemo(() => {
    if (roles.length === 0) return 'No role';
    if (roles.length === 1 && activeRole) {
      return `${roleLabel(activeRole)} · Shared roster`;
    }
    return 'Shared roster';
  }, [roles, activeRole]);

  const value = useMemo<ActiveRoleValue>(
    () => ({
      rosterId,
      roles,
      activeRole,
      workspaces,
      activeWorkspace,
      activeWorkspaceId: activeWorkspace?.id ?? null,
      workspaceKind,
      canEditActiveWorkspace,
      loading,
      error,
      isAdmin,
      adminEditMode,
      isAdminLiveMode,
      setActiveRole,
      setAdminEditMode,
      refreshRoles,
      roleLabel,
      workspaceLabel,
    }),
    [
      rosterId,
      roles,
      activeRole,
      workspaces,
      activeWorkspace,
      workspaceKind,
      canEditActiveWorkspace,
      loading,
      error,
      isAdmin,
      setActiveRole,
      setAdminEditMode,
      refreshRoles,
      workspaceLabel,
    ]
  );

  return (
    <ActiveRoleContext.Provider value={value}>
      {children}
    </ActiveRoleContext.Provider>
  );
}

export function useActiveRole(): ActiveRoleValue {
  const ctx = useContext(ActiveRoleContext);
  if (!ctx) {
    throw new Error('useActiveRole must be used within ActiveRoleProvider');
  }
  return ctx;
}
