import { useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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

type NavTab = {
  key: Exclude<MainTab, 'print' | 'team'>;
  label: string;
  shortLabel: string;
  href: string;
};

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
  const { isPhone, isTablet } = useLayout();
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

  const navTabs: NavTab[] = [
    {
      key: 'positions',
      label: 'Assign Positions',
      shortLabel: 'Positions',
      href: `/roster/${rosterId}`,
    },
    {
      key: 'depth',
      label: 'Depth Chart',
      shortLabel: 'Depth',
      href: `/roster/${rosterId}/depth`,
    },
    {
      key: 'assign',
      label: 'Assign Squads',
      shortLabel: 'Squads',
      href: `/roster/${rosterId}/assign`,
    },
    {
      key: 'players',
      label: 'All Players',
      shortLabel: 'Players',
      href: `/roster/${rosterId}/players`,
    },
  ];

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

  function openPrintMenu() {
    setAccountMenuOpen(false);
    if (isPhone) {
      const options = ['Cancel', 'Rosters', 'Squad Planner'] as const;
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [...options],
            cancelButtonIndex: 0,
          },
          (buttonIndex) => {
            if (buttonIndex === 1) goPrint('rosters');
            if (buttonIndex === 2) goPrint('planner');
          }
        );
        return;
      }
      Alert.alert('Print View', undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Rosters', onPress: () => goPrint('rosters') },
        { text: 'Squad Planner', onPress: () => goPrint('planner') },
      ]);
      return;
    }
    setPrintMenuOpen((open) => !open);
  }

  function openAccountMenu() {
    setPrintMenuOpen(false);
    if (isPhone) {
      const options = isAdmin
        ? (['Cancel', 'Team / Invites', 'Sign out'] as const)
        : (['Cancel', 'Sign out'] as const);
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [...options],
            cancelButtonIndex: 0,
            destructiveButtonIndex: options.length - 1,
          },
          (buttonIndex) => {
            if (isAdmin) {
              if (buttonIndex === 1) goTeamInvites();
              if (buttonIndex === 2) void handleSignOut();
            } else if (buttonIndex === 1) {
              void handleSignOut();
            }
          }
        );
        return;
      }
      Alert.alert('Account', userLabel(user?.email), [
        { text: 'Cancel', style: 'cancel' },
        ...(isAdmin
          ? [{ text: 'Team / Invites', onPress: () => goTeamInvites() }]
          : []),
        {
          text: 'Sign out',
          style: 'destructive' as const,
          onPress: () => void handleSignOut(),
        },
      ]);
      return;
    }
    setAccountMenuOpen((open) => !open);
  }

  function isTabActive(key: NavTab['key']) {
    if (key === 'positions') return onPositions;
    if (key === 'depth') return onDepth;
    if (key === 'assign') return onAssign;
    return onAllPlayers;
  }

  const topPad = Math.max(insets.top, 8) + (isTablet ? 20 : isPhone ? 4 : 8);
  // Horizontal safe area is applied by the roster layout; keep only content gutter here.
  const sidePad = isPhone ? 12 : 20;

  const statusBanners = (
    <>
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
    </>
  );

  if (isPhone) {
    return (
      <View style={styles.wrap}>
        <View
          style={[
            styles.phoneBar,
            {
              paddingTop: topPad,
              paddingHorizontal: sidePad,
            },
          ]}
        >
          <View style={styles.phoneTopRow}>
            <Pressable
              style={styles.dashboard}
              onPress={() => router.replace('/dashboard')}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            >
              <Text style={styles.dashboardText}>Dashboard</Text>
            </Pressable>
            <Pressable
              style={[
                styles.phoneAccountBtn,
                onTeam && styles.phoneAccountBtnActive,
              ]}
              onPress={openAccountMenu}
            >
              <Text style={styles.phoneAccountText} numberOfLines={1}>
                {userLabel(user?.email)}
              </Text>
              <Text style={styles.phoneAccountChevron}>▾</Text>
            </Pressable>
          </View>

          <View style={styles.phoneRoleRow}>
            <RoleSwitcher />
          </View>

          <View style={styles.phoneTabGrid}>
            {navTabs.map((tab) => {
              const active = isTabActive(tab.key);
              return (
                <Pressable
                  key={tab.key}
                  style={[styles.phoneTab, active && styles.tabActive]}
                  onPress={() => router.replace(tab.href)}
                >
                  <Text
                    style={[styles.phoneTabText, active && styles.tabTextActive]}
                    numberOfLines={1}
                  >
                    {tab.shortLabel}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              style={[
                styles.phoneTab,
                styles.phoneTabWide,
                onPrintView && styles.tabActive,
              ]}
              onPress={openPrintMenu}
            >
              <Text
                style={[
                  styles.phoneTabText,
                  onPrintView && styles.tabTextActive,
                ]}
                numberOfLines={1}
              >
                Print View ▾
              </Text>
            </Pressable>
          </View>
        </View>
        {statusBanners}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.bar,
          {
            paddingTop: topPad,
            paddingHorizontal: sidePad,
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
            {navTabs.map((tab) => {
              const active = isTabActive(tab.key);
              return (
                <Pressable
                  key={tab.key}
                  style={[styles.tab, active && styles.tabActive]}
                  onPress={() => router.replace(tab.href)}
                >
                  <Text
                    style={[styles.tabText, active && styles.tabTextActive]}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
            <View style={styles.printWrap}>
              <Pressable
                style={[styles.tab, onPrintView && styles.tabActive]}
                onPress={openPrintMenu}
              >
                <Text
                  style={[styles.tabText, onPrintView && styles.tabTextActive]}
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
                onPress={openAccountMenu}
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
      {statusBanners}
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
  phoneBar: {
    paddingBottom: 10,
    gap: 10,
  },
  phoneTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  phoneRoleRow: {
    marginTop: -4,
  },
  phoneAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: '52%',
  },
  phoneAccountBtnActive: {
    borderColor: colors.primary,
  },
  phoneAccountText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  phoneAccountChevron: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
  },
  phoneTabGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  phoneTab: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneTabWide: {
    flexBasis: '100%',
  },
  phoneTabText: {
    fontWeight: '700',
    color: colors.text,
    fontSize: 13,
  },
  offlineBanner: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#e2e8f0',
    borderTopWidth: 1,
    borderTopColor: '#cbd5e1',
    alignItems: 'center',
  },
  syncBanner: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#dbeafe',
    borderTopWidth: 1,
    borderTopColor: '#93c5fd',
    alignItems: 'center',
  },
  syncErrorBanner: {
    paddingHorizontal: 16,
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
    paddingVertical: 8,
    paddingHorizontal: 2,
    minHeight: 40,
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
