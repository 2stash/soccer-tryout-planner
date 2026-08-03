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
  listRosterWorkspaces,
  resolveWorkspaceForRole,
  workspaceKindForRole,
  workspaceKindLabel,
} from '@/lib/workspaces';

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
  /** Admin-only: personal test overlay vs live head-coach masters. */
  adminEditMode: AdminEditMode;
  /** True when Admin is acting in Live Rosters mode. */
  isAdminLiveMode: boolean;
  setActiveRole: (role: RosterRole) => void;
  setAdminEditMode: (mode: AdminEditMode) => void;
  refreshRoles: () => Promise<void>;
  roleLabel: (role: RosterRole) => string;
  workspaceLabel: string;
};

const ActiveRoleContext = createContext<ActiveRoleValue | null>(null);

function storageKey(rosterId: string, userId: string) {
  return `activeRole:${rosterId}:${userId}`;
}

function adminModeStorageKey(rosterId: string, userId: string) {
  return `adminEditMode:${rosterId}:${userId}`;
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
  const [adminEditMode, setAdminEditModeState] =
    useState<AdminEditMode>('personal');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshRoles = useCallback(async () => {
    if (!user) {
      setRoles([]);
      setWorkspaces([]);
      setActiveRoleState(null);
      setAdminEditModeState('personal');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [nextRoles, nextWorkspaces] = await Promise.all([
        listMyRolesOnRoster(rosterId, user.id),
        listRosterWorkspaces(rosterId),
      ]);
      setRoles(nextRoles);
      setWorkspaces(nextWorkspaces);

      const [stored, storedMode] = await Promise.all([
        AsyncStorage.getItem(storageKey(rosterId, user.id)),
        AsyncStorage.getItem(adminModeStorageKey(rosterId, user.id)),
      ]);
      const storedRole = stored as RosterRole | null;
      if (storedRole && nextRoles.includes(storedRole)) {
        setActiveRoleState(storedRole);
      } else if (nextRoles.length > 0) {
        const fallback = pickDefaultActiveRole(nextRoles);
        setActiveRoleState(fallback);
        await AsyncStorage.setItem(
          storageKey(rosterId, user.id),
          fallback
        );
      } else {
        setActiveRoleState(null);
      }

      if (nextRoles.includes('admin') && storedMode === 'live') {
        setAdminEditModeState('live');
      } else {
        setAdminEditModeState('personal');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load roles');
      setRoles([]);
      setWorkspaces([]);
      setActiveRoleState(null);
      setAdminEditModeState('personal');
    } finally {
      setLoading(false);
    }
  }, [rosterId, user]);

  useEffect(() => {
    void refreshRoles();
  }, [refreshRoles]);

  const setActiveRole = useCallback(
    (role: RosterRole) => {
      if (!roles.includes(role) || !user) return;
      setActiveRoleState(role);
      void AsyncStorage.setItem(storageKey(rosterId, user.id), role);
    },
    [roles, rosterId, user]
  );

  const setAdminEditMode = useCallback(
    (mode: AdminEditMode) => {
      if (!user || !roles.includes('admin')) return;
      setAdminEditModeState(mode);
      void AsyncStorage.setItem(adminModeStorageKey(rosterId, user.id), mode);
    },
    [roles, rosterId, user]
  );

  const activeWorkspace = useMemo(() => {
    if (!user || !activeRole) return null;
    return resolveWorkspaceForRole({
      workspaces,
      role: activeRole,
      userId: user.id,
    });
  }, [user, activeRole, workspaces]);

  const workspaceKind = activeRole
    ? workspaceKindForRole(activeRole)
    : null;

  const canEditActiveWorkspace = useMemo(() => {
    if (!activeWorkspace || !user || !activeRole) return false;
    if (activeWorkspace.kind === 'personal') {
      return activeWorkspace.user_id === user.id;
    }
    // Masters: matching head coach or admin (admin can edit all masters).
    if (roles.includes('admin')) return true;
    if (
      activeWorkspace.kind === 'master_varsity' &&
      roles.includes('varsity_coach')
    ) {
      return true;
    }
    if (activeWorkspace.kind === 'master_jv' && roles.includes('jv_coach')) {
      return true;
    }
    if (
      activeWorkspace.kind === 'master_fr_soph' &&
      roles.includes('fr_soph_coach')
    ) {
      return true;
    }
    return false;
  }, [activeWorkspace, user, activeRole, roles]);

  const isAdmin = roles.includes('admin');
  const isAdminLiveMode =
    isAdmin && activeRole === 'admin' && adminEditMode === 'live';

  const workspaceLabel = useMemo(() => {
    if (!activeRole) return 'No role';
    if (activeRole === 'admin') {
      return adminEditMode === 'live'
        ? 'Admin · Live coaches'
        : 'Admin · Personal (test)';
    }
    const role = roleLabel(activeRole);
    const kind = workspaceKindLabel(workspaceKindForRole(activeRole));
    return `${role} · ${kind}`;
  }, [activeRole, adminEditMode]);

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
      adminEditMode,
      isAdminLiveMode,
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
