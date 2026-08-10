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
import { router, usePathname, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HoldTryoutModal } from '@/components/HoldTryoutModal';
import { RoleSwitcher } from '@/components/RoleSwitcher';
import { useActiveRole } from '@/lib/ActiveRoleContext';
import { useAuth } from '@/lib/AuthContext';
import { confirmAction } from '@/lib/confirm';
import { useLayout } from '@/lib/layout';
import { alertRequiresOnline } from '@/lib/offline/gate';
import { useOffline } from '@/lib/offline/OfflineContext';
import { useRosterData } from '@/lib/RosterDataContext';
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
  | 'tryout'
  | 'time-trial'
  | 'print'
  | 'team';

type NavTab = {
  key: Exclude<MainTab, 'print' | 'team'>;
  label: string;
  shortLabel: string;
  href: Href;
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
  if (pathname.includes('/time-trial')) return 'time-trial';
  if (pathname.includes('/tryout')) return 'tryout';
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
  const { roster, startTryout, endTryout } = useRosterData();
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
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdBusy, setHoldBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<MainTab>(
    () => mainTabFromPath(pathname) ?? 'positions'
  );
  const tryoutActive = Boolean(roster?.tryout_active);
  const onAssign = activeTab === 'assign';
  const onAllPlayers = activeTab === 'players';
  const onTryout = activeTab === 'tryout';
  const onTimeTrial = activeTab === 'time-trial';
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
      href: `/roster/${rosterId}` as Href,
    },
    {
      key: 'depth',
      label: 'Depth Chart',
      shortLabel: 'Depth',
      href: `/roster/${rosterId}/depth` as Href,
    },
    {
      key: 'assign',
      label: 'Assign Squads',
      shortLabel: 'Squads',
      href: `/roster/${rosterId}/assign` as Href,
    },
    {
      key: 'players',
      label: 'All Players',
      shortLabel: 'Players',
      href: `/roster/${rosterId}/players` as Href,
    },
    ...(tryoutActive
      ? [
          {
            key: 'tryout' as const,
            label: 'Tryout',
            shortLabel: 'Tryout',
            href: `/roster/${rosterId}/tryout` as Href,
          },
          {
            key: 'time-trial' as const,
            label: 'Time Trial',
            shortLabel: 'Times',
            href: `/roster/${rosterId}/time-trial` as Href,
          },
        ]
      : []),
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
    if (path === 'rosters' && onRosters) return;
    if (path === 'planner' && onPlanner) return;
    router.replace(`/roster/${rosterId}/${path}`);
  }

  function goTab(tab: NavTab) {
    if (isTabActive(tab.key)) return;
    router.replace(tab.href);
  }

  function goTeamInvites() {
    setAccountMenuOpen(false);
    router.replace(`/roster/${rosterId}/team`);
  }

  function openHoldTryouts() {
    setAccountMenuOpen(false);
    if (!isOnline) {
      alertRequiresOnline('Hold tryouts');
      return;
    }
    setHoldOpen(true);
  }

  function confirmEndTryout() {
    setAccountMenuOpen(false);
    if (!isOnline) {
      alertRequiresOnline('End tryout');
      return;
    }
    confirmAction({
      title: 'End tryout?',
      message:
        'Lock in teams and begin season. The Tryout tab will be removed; attendance and tryout numbers are kept.',
      confirmLabel: 'End tryout',
      onConfirm: () => {
        void (async () => {
          try {
            await endTryout();
            if (
              pathname.includes('/tryout') ||
              pathname.includes('/time-trial')
            ) {
              router.replace(`/roster/${rosterId}/players`);
            }
          } catch {
            // Error surfaced via RosterDataContext
          }
        })();
      },
    });
  }

  async function handleBeginTryout(dayCount: number) {
    setHoldBusy(true);
    try {
      await startTryout(dayCount);
      setHoldOpen(false);
      router.replace(`/roster/${rosterId}/tryout`);
    } catch {
      // Error surfaced via RosterDataContext
    } finally {
      setHoldBusy(false);
    }
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

  function currentPageLabel() {
    if (onPrintView) return onPlanner ? 'Squad Planner' : 'Rosters';
    const tab = navTabs.find((t) => isTabActive(t.key));
    return tab?.label ?? 'Page';
  }

  function openPageMenu() {
    setAccountMenuOpen(false);
    setPrintMenuOpen(false);
    const mainTabs = navTabs.filter(
      (t) => t.key !== 'tryout' && t.key !== 'time-trial'
    );
    const tryoutTabs = navTabs.filter(
      (t) => t.key === 'tryout' || t.key === 'time-trial'
    );
    const TRYOUT_SECTION = '—— Tryout mode ——';
    const pageOptions = [
      ...mainTabs.map((t) => t.label),
      'Rosters',
      'Squad Planner',
      ...(tryoutTabs.length > 0
        ? [TRYOUT_SECTION, ...tryoutTabs.map((t) => t.label)]
        : []),
    ];
    const options = ['Cancel', ...pageOptions];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex <= 0) return;
          const label = pageOptions[buttonIndex - 1];
          if (label === TRYOUT_SECTION) return;
          if (label === 'Rosters') {
            goPrint('rosters');
            return;
          }
          if (label === 'Squad Planner') {
            goPrint('planner');
            return;
          }
          const tab = navTabs.find((t) => t.label === label);
          if (tab) goTab(tab);
        }
      );
      return;
    }
    Alert.alert('Go to', undefined, [
      { text: 'Cancel', style: 'cancel' },
      ...mainTabs.map((tab) => ({
        text: tab.label,
        onPress: () => goTab(tab),
      })),
      { text: 'Rosters', onPress: () => goPrint('rosters') },
      { text: 'Squad Planner', onPress: () => goPrint('planner') },
      ...(tryoutTabs.length > 0
        ? [
            {
              text: TRYOUT_SECTION,
              onPress: () => {},
            },
            ...tryoutTabs.map((tab) => ({
              text: tab.label,
              onPress: () => goTab(tab),
            })),
          ]
        : []),
    ]);
  }

  function openAccountMenu() {
    setPrintMenuOpen(false);
    if (isPhone) {
      const adminOptions = tryoutActive
        ? (['Cancel', 'Team / Invites', 'End tryout', 'Sign out'] as const)
        : (['Cancel', 'Team / Invites', 'Hold Tryouts', 'Sign out'] as const);
      const options = isAdmin ? adminOptions : (['Cancel', 'Sign out'] as const);
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [...options],
            cancelButtonIndex: 0,
            destructiveButtonIndex: options.length - 1,
          },
          (buttonIndex) => {
            if (!isAdmin) {
              if (buttonIndex === 1) void handleSignOut();
              return;
            }
            if (buttonIndex === 1) goTeamInvites();
            if (buttonIndex === 2) {
              if (tryoutActive) confirmEndTryout();
              else openHoldTryouts();
            }
            if (buttonIndex === 3) void handleSignOut();
          }
        );
        return;
      }
      Alert.alert('Account', userLabel(user?.email), [
        { text: 'Cancel', style: 'cancel' },
        ...(isAdmin
          ? [
              { text: 'Team / Invites', onPress: () => goTeamInvites() },
              tryoutActive
                ? {
                    text: 'End tryout',
                    style: 'destructive' as const,
                    onPress: () => confirmEndTryout(),
                  }
                : {
                    text: 'Hold Tryouts',
                    onPress: () => openHoldTryouts(),
                  },
            ]
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
    if (key === 'tryout') return onTryout;
    if (key === 'time-trial') return onTimeTrial;
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

          <Pressable style={styles.phonePageBtn} onPress={openPageMenu}>
            <Text style={styles.phonePageLabel} numberOfLines={1}>
              {currentPageLabel()}
            </Text>
            <Text style={styles.phonePageChevron}>▾</Text>
          </Pressable>
        </View>
        {statusBanners}
        <HoldTryoutModal
          visible={holdOpen}
          busy={holdBusy}
          onCancel={() => {
            if (!holdBusy) setHoldOpen(false);
          }}
          onBegin={handleBeginTryout}
        />
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
            {navTabs
              .filter((t) => t.key !== 'tryout' && t.key !== 'time-trial')
              .map((tab) => {
                const active = isTabActive(tab.key);
                return (
                  <Pressable
                    key={tab.key}
                    style={[styles.tab, active && styles.tabActive]}
                    onPress={() => goTab(tab)}
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
            {tryoutActive ? (
              <>
                <View style={styles.tryoutDivider} />
                {navTabs
                  .filter((t) => t.key === 'tryout' || t.key === 'time-trial')
                  .map((tab) => {
                    const active = isTabActive(tab.key);
                    return (
                      <Pressable
                        key={tab.key}
                        style={[
                          styles.tab,
                          styles.tryoutTab,
                          active && styles.tryoutTabActive,
                        ]}
                        onPress={() => goTab(tab)}
                      >
                        <Text
                          style={[
                            styles.tabText,
                            styles.tryoutTabText,
                            active && styles.tryoutTabTextActive,
                          ]}
                        >
                          {tab.label}
                        </Text>
                      </Pressable>
                    );
                  })}
              </>
            ) : null}
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
                    <>
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
                      {tryoutActive ? (
                        <Pressable
                          style={styles.accountItem}
                          onPress={confirmEndTryout}
                        >
                          <Text style={styles.accountItemText}>End tryout</Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          style={styles.accountItem}
                          onPress={openHoldTryouts}
                        >
                          <Text style={styles.accountItemText}>
                            Hold Tryouts
                          </Text>
                        </Pressable>
                      )}
                    </>
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
      <HoldTryoutModal
        visible={holdOpen}
        busy={holdBusy}
        onCancel={() => {
          if (!holdBusy) setHoldOpen(false);
        }}
        onBegin={handleBeginTryout}
      />
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
  phonePageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  phonePageLabel: {
    flex: 1,
    fontWeight: '800',
    color: colors.text,
    fontSize: 15,
  },
  phonePageChevron: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.muted,
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
  tryoutDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: '#c5e4d4',
    marginHorizontal: 4,
  },
  tryoutTab: {
    backgroundColor: colors.tryoutPresentBg,
    borderColor: '#9cc4b3',
  },
  tryoutTabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tryoutTabText: {
    color: '#0a5a41',
  },
  tryoutTabTextActive: {
    color: colors.primaryText,
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
