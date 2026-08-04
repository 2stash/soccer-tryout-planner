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

function userLabel(email: string | undefined) {
  if (!email) return 'Signed in';
  const at = email.indexOf('@');
  if (at > 0 && at <= 18) return email.slice(0, at);
  if (email.length <= 22) return email;
  return `${email.slice(0, 20)}…`;
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
  const onAssign = pathname.includes('/assign');
  const onPlanner = pathname.includes('/planner');
  const onDepth = pathname.includes('/depth');
  const onRosters = pathname.includes('/rosters');
  const onTeam = pathname.includes('/team');
  const onPrintView = onRosters || onPlanner;
  const onPlayers =
    !onAssign && !onPlanner && !onDepth && !onRosters && !onTeam;

  useEffect(() => {
    setPrintMenuOpen(false);
  }, [pathname]);

  async function handleSignOut() {
    await signOut();
    router.replace('/(auth)/sign-in');
  }

  function goPrint(path: 'rosters' | 'planner') {
    setPrintMenuOpen(false);
    router.replace(`/roster/${rosterId}/${path}`);
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
            {isAdmin ? (
              <Pressable
                style={[styles.teamLink, onTeam && styles.teamLinkActive]}
                onPress={() => router.replace(`/roster/${rosterId}/team`)}
              >
                <Text
                  style={[
                    styles.teamLinkText,
                    onTeam && styles.teamLinkTextActive,
                  ]}
                >
                  Team / Invites
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.tabs}>
            <Pressable
              style={[styles.tab, onPlayers && styles.tabActive]}
              onPress={() => router.replace(`/roster/${rosterId}`)}
            >
              <Text style={[styles.tabText, onPlayers && styles.tabTextActive]}>
                All Players
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
            <View style={styles.printWrap}>
              <Pressable
                style={[styles.tab, onPrintView && styles.tabActive]}
                onPress={() => setPrintMenuOpen((open) => !open)}
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
            <Text style={styles.userEmail} numberOfLines={1}>
              {userLabel(user?.email)}
            </Text>
            <Pressable
              style={styles.signOut}
              onPress={() => void handleSignOut()}
            >
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>
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
  teamLink: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  teamLinkActive: {
    backgroundColor: colors.primary,
  },
  teamLinkText: {
    color: colors.primary,
    fontWeight: '800',
    fontSize: 13,
  },
  teamLinkTextActive: {
    color: colors.primaryText,
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
  userEmail: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 140,
  },
  signOut: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  signOutText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 13,
  },
});
