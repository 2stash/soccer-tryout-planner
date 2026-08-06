import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RoleSwitcher } from '@/components/RoleSwitcher';
import { useActiveRole } from '@/lib/ActiveRoleContext';
import { useAuth } from '@/lib/AuthContext';
import { useLayout } from '@/lib/layout';
import { useOffline } from '@/lib/offline/OfflineContext';
import { colors } from '@/constants/theme';

type Props = {
  rosterId: string;
};

/** Main roster tabs — add/import are overlays and keep the prior tab highlighted. */
type MainTab =
  | 'positions'
  | 'depth'
  | 'assign'
  | 'players'
  | 'print'
  | 'team';

function userLabel(email: string | undefined) {
  if (!email) return 'Signed in';
  const at = email.indexOf('@');
  if (at > 0 && at <= 18) return email.slice(0, at);
  if (email.length <= 22) return email;
  return `${email.slice(0, 20)}…`;
}

function mainTabFromPath(pathname: string): MainTab | null {
  if (pathname.includes('/add') || pathname.includes('/import')) return null;
  if (pathname.includes('/assign')) return 'assign';
  if (pathname.includes('/players')) return 'players';
  if (pathname.includes('/depth')) return 'depth';
  if (pathname.includes('/rosters') || pathname.includes('/planner')) {
    return 'print';
  }
  if (pathname.includes('/team')) return 'team';
  return 'positions';
}

export function RosterSubnav({ rosterId }: Props) {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { isTablet } = useLayout();
  const { user, signOut } = useAuth();
  const { isAdmin } = useActiveRole();
  const {
    isOnline,
    isSyncing,
    pendingCount,
    syncError,
    offlineReady,
    retrySync,
  } = useOffline();
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<MainTab>(
    () => mainTabFromPath(pathname) ?? 'positions'
  );
  const onAssign = activeTab === 'assign';
  const onAllPlayers = activeTab === 'players';
  const onPlanner = pathname.includes('/planner');
  const onDepth = activeTab === 'depth';
  const onRosters = pathname.includes('/rosters');
  const onTeam = activeTab === 'team';
  const onPrintView = activeTab === 'print';
  const onPositions = activeTab === 'positions';

  useEffect(() => {
    setPrintMenuOpen(false);
    setAccountMenuOpen(false);
    const tab = mainTabFromPath(pathname);
    if (tab) setActiveTab(tab);
  }, [pathname]);

  async function handleSignOut() {
    setAccountMenuOpen(false);
    await signOut();
    router.replace('/(auth)/sign-in');
  }

  function goPrint(path: 'rosters' | 'planner') {
    setPrintMenuOpen(false);
    setAccountMenuOpen(false);
    router.replace(`/roster/${rosterId}/${path}`);
  }

  function goTeamInvites() {
    setAccountMenuOpen(false);
    router.replace(`/roster/${rosterId}/team`);
  }

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.bar,
          {
            // iPad status / multitasking chrome needs extra clearance.
            paddingTop: Math.max(insets.top, 8) + (isTablet ? 20 : 8),
            paddingLeft: Math.max(insets.left, 20),
            paddingRight: Math.max(insets.right, 20),
          },
        ]}
      >
        <View style={styles.inner}>
          <View style={styles.side}>
            <Pressable
              style={styles.dashboard}
              onPress={() => router.replace('/dashboard')}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.dashboardText}>Dashboard</Text>
            </Pressable>
          </View>

          <View style={styles.tabs}>
            <Pressable
              style={[styles.tab, onPositions && styles.tabActive]}
              onPress={() => router.replace(`/roster/${rosterId}`)}
            >
              <Text
                style={[styles.tabText, onPositions && styles.tabTextActive]}
              >
                Assign Positions
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, onDepth && styles.tabActive]}
              onPress={() => router.replace(`/roster/${rosterId}/depth`)}
            >
              <Text style={[styles.tabText, onDepth && styles.tabTextActive]}>
                Depth Chart
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, onAssign && styles.tabActive]}
              onPress={() => router.replace(`/roster/${rosterId}/assign`)}
            >
              <Text style={[styles.tabText, onAssign && styles.tabTextActive]}>
                Assign Squads
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, onAllPlayers && styles.tabActive]}
              onPress={() => router.replace(`/roster/${rosterId}/players`)}
            >
              <Text
                style={[styles.tabText, onAllPlayers && styles.tabTextActive]}
              >
                All Players
              </Text>
            </Pressable>
            <View style={styles.printWrap}>
              <Pressable
                style={[styles.tab, onPrintView && styles.tabActive]}
                onPress={() => {
                  setAccountMenuOpen(false);
                  setPrintMenuOpen((open) => !open);
                }}
              >
                <Text
                  style={[
                    styles.tabText,
                    onPrintView && styles.tabTextActive,
                  ]}
                >
                  {`Print View${printMenuOpen ? ' ▲' : ' ▼'}`}
                </Text>
              </Pressable>
              {printMenuOpen ? (
                <View style={styles.printMenu}>
                  <Pressable
                    style={[
                      styles.printItem,
                      onRosters && styles.printItemActive,
                    ]}
                    onPress={() => goPrint('rosters')}
                  >
                    <Text
                      style={[
                        styles.printItemText,
                        onRosters && styles.printItemTextActive,
                      ]}
                    >
                      Rosters
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.printItem,
                      onPlanner && styles.printItemActive,
                    ]}
                    onPress={() => goPrint('planner')}
                  >
                    <Text
                      style={[
                        styles.printItemText,
                        onPlanner && styles.printItemTextActive,
                      ]}
                    >
                      Squad Planner
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>

          <View style={[styles.side, styles.userSide]}>
            <RoleSwitcher />
            <View style={styles.accountWrap}>
              <Pressable
                style={[
                  styles.accountBtn,
                  (accountMenuOpen || onTeam) && styles.accountBtnOpen,
                ]}
                onPress={() => {
                  setPrintMenuOpen(false);
                  setAccountMenuOpen((open) => !open);
                }}
              >
                <Text style={styles.accountBtnLabel}>Account</Text>
                <Text style={styles.accountBtnUser} numberOfLines={1}>
                  {userLabel(user?.email)}
                  {accountMenuOpen ? ' ▲' : ' ▼'}
                </Text>
              </Pressable>
              {accountMenuOpen ? (
                <View style={styles.accountMenu}>
                  {isAdmin ? (
                    <Pressable
                      style={[
                        styles.accountItem,
                        onTeam && styles.accountItemActive,
                      ]}
                      onPress={goTeamInvites}
                    >
                      <Text
                        style={[
                          styles.accountItemText,
                          onTeam && styles.accountItemTextActive,
                        ]}
                      >
                        Team / Invites
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={styles.accountItem}
                    onPress={() => void handleSignOut()}
                  >
                    <Text style={styles.accountItemText}>Sign out</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </View>
      {!isOnline ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            {offlineReady
              ? pendingCount > 0
                ? `Offline — ${pendingCount} change${pendingCount === 1 ? '' : 's'} pending`
                : 'Offline — editing saved on this device'
              : 'Offline — connect once to use this roster offline'}
          </Text>
        </View>
      ) : null}
      {isOnline && isSyncing ? (
        <View style={styles.syncBanner}>
          <Text style={styles.offlineBannerText}>
            Syncing{pendingCount > 0 ? ` (${pendingCount} left)` : '…'}
          </Text>
        </View>
      ) : null}
      {isOnline && !isSyncing && pendingCount > 0 && !syncError ? (
        <Pressable style={styles.syncBanner} onPress={retrySync}>
          <Text style={styles.offlineBannerText}>
            {pendingCount} change{pendingCount === 1 ? '' : 's'} waiting to
            sync. Tap to sync now.
          </Text>
        </Pressable>
      ) : null}
      {isOnline && syncError ? (
        <Pressable style={styles.syncErrorBanner} onPress={retrySync}>
          <Text style={styles.offlineBannerText}>
            Sync failed: {syncError}. Tap to retry.
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
    zIndex: 20,
  },
  bar: {
    paddingBottom: 8,
    alignItems: 'center',
    zIndex: 20,
  },
  offlineBanner: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: '#e2e8f0',
    borderTopWidth: 1,
    borderTopColor: '#cbd5e1',
    alignItems: 'center',
  },
  syncBanner: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: '#dbeafe',
    borderTopWidth: 1,
    borderTopColor: '#93c5fd',
    alignItems: 'center',
  },
  syncErrorBanner: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: colors.dangerBg,
    borderTopWidth: 1,
    borderTopColor: '#fca5a5',
    alignItems: 'center',
  },
  offlineBannerText: {
    width: '100%',
    maxWidth: 960,
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  inner: {
    width: '100%',
    maxWidth: 960,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
  },
  side: {
    flex: 1,
    minWidth: 160,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  userSide: {
    justifyContent: 'flex-end',
    gap: 10,
  },
  dashboard: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    minHeight: 44,
    justifyContent: 'center',
  },
  dashboardText: {
    color: colors.primary,
    fontWeight: '800',
    fontSize: 15,
  },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    zIndex: 30,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabText: {
    fontWeight: '700',
    color: colors.text,
    fontSize: 14,
  },
  tabTextActive: {
    color: colors.primaryText,
  },
  printWrap: {
    position: 'relative',
    zIndex: 40,
  },
  printMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 4,
    minWidth: 160,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    shadowColor: '#15202b',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  printItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  printItemActive: {
    backgroundColor: '#e8f5ef',
  },
  printItemText: {
    fontWeight: '700',
    color: colors.text,
    fontSize: 14,
  },
  printItemTextActive: {
    color: colors.primary,
  },
  accountWrap: {
    position: 'relative',
    zIndex: 40,
  },
  accountBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 120,
    maxWidth: 180,
    gap: 1,
  },
  accountBtnOpen: {
    borderColor: colors.primary,
  },
  accountBtnLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  accountBtnUser: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  accountMenu: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    minWidth: 180,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    shadowColor: '#15202b',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  accountItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  accountItemActive: {
    backgroundColor: '#e8f5ef',
  },
  accountItemText: {
    fontWeight: '700',
    color: colors.text,
    fontSize: 14,
  },
  accountItemTextActive: {
    color: colors.primary,
  },
});
