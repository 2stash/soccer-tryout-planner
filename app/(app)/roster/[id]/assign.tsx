import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { confirmAction } from '@/lib/confirm';
import {
  downloadFullPlayersCsv,
  downloadNamesYearCsv,
} from '@/lib/exportPlayers';
import { alertRequiresOnline } from '@/lib/offline/gate';
import { useOffline } from '@/lib/offline/OfflineContext';
import { useRosterData } from '@/lib/RosterDataContext';
import { useLayout } from '@/lib/layout';
import type { Player, PlayerAssignment, SquadTeam } from '@/lib/types';
import {
  isSquadTeam,
  SQUAD_TEAMS,
  UNAVAILABLE_POOL,
} from '@/lib/types';
import {
  playersInRankPool,
  rankPoolLabel,
  type RankPool,
} from '@/lib/assignPools';
import { formatPositionsShort } from '@/lib/positions';
import {
  filterAvailableByGrade,
  orderAvailablePlayers,
  type GradeFilter,
} from '@/lib/availableRank';
import { comparePlayersByName } from '@/lib/playerSort';
import {
  CLASS_ORDER_DESC,
  countBySchoolYear,
  formatClassCounts,
} from '@/lib/schoolYear';
import { playerAttendedAnyTryout } from '@/lib/tryout';
import { colors, layout } from '@/constants/theme';

type PoolKey = RankPool | SquadTeam;
type PhoneTabKey = PoolKey;

function isRankPoolKey(key: PoolKey): key is RankPool {
  return key === 'available' || key === 'unavailable';
}

const GRADE_FILTERS: { key: GradeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...CLASS_ORDER_DESC.map((y) => ({ key: y as GradeFilter, label: y })),
];

function matchesFilter(player: Player, q: string) {
  if (!q) return true;
  const posLabel = formatPositionsShort(player.positions).toLowerCase();
  const squadLabel =
    player.squad_team === 'varsity'
      ? 'varsity'
      : player.squad_team === 'jv'
        ? 'jv'
        : player.squad_team === 'fr_soph'
          ? 'fr/soph fr soph'
          : player.squad_team === 'unavailable'
            ? 'unavailable'
            : 'available unassigned';
  return (
    (player.first_name ?? '').toLowerCase().includes(q) ||
    (player.last_name ?? '').toLowerCase().includes(q) ||
    posLabel.includes(q) ||
    (player.school_year ?? '').toLowerCase().includes(q) ||
    squadLabel.includes(q)
  );
}

function playerMeta(p: Player, opts?: { omitYear?: boolean }) {
  const parts: string[] = [];
  if (!opts?.omitYear && p.school_year) parts.push(p.school_year);
  const pos = formatPositionsShort(p.positions);
  if (pos) parts.push(pos);
  return parts.join(' · ');
}

function teamBtnLabel(teamId: SquadTeam, short: boolean) {
  if (!short) {
    return SQUAD_TEAMS.find((t) => t.id === teamId)?.label ?? teamId;
  }
  if (teamId === 'varsity') return 'Var';
  if (teamId === 'jv') return 'JV';
  return 'Fr';
}

/** Three team panels side-by-side (desktop + iPad landscape). */
const THREE_TEAM_COLS_MIN = 900;

export default function AssignSquadsScreen() {
  const { session, loading: authLoading, configured } = useAuth();
  const { width, isPhone, isCompact } = useLayout();
  const { isOnline } = useOffline();
  const {
    rosterId,
    roster,
    players,
    loading,
    error,
    clearError,
    assignSquad,
    ensureAvailableRanks,
    moveAvailable,
    toggleAvailablePin,
    moveAvailableToTop,
    moveAvailableToBottom,
    resetAvailableOrder,
  } = useRosterData();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sortingPool, setSortingPool] = useState<RankPool | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [phoneTab, setPhoneTab] = useState<PhoneTabKey>('available');
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>('all');
  const [filter, setFilter] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const threeTeamCols = !isPhone && width >= THREE_TEAM_COLS_MIN;
  const tightTeamRows = threeTeamCols;
  const filterQ = filter.trim().toLowerCase();

  const poolTabs = useMemo(
    (): { key: PhoneTabKey; label: string }[] => [
      { key: 'available', label: 'Available' },
      { key: 'unavailable', label: 'Unavailable' },
      ...SQUAD_TEAMS.map((t) => ({
        key: t.id as PoolKey,
        label: t.label,
      })),
    ],
    []
  );

  const editableSquads = useMemo(
    (): SquadTeam[] => SQUAD_TEAMS.map((t) => t.id),
    []
  );

  const availablePlayers = useMemo(
    () => orderAvailablePlayers(playersInRankPool(players, 'available')),
    [players]
  );

  const unavailablePlayers = useMemo(
    () => orderAvailablePlayers(playersInRankPool(players, 'unavailable')),
    [players]
  );

  const availableVisible = useMemo(
    () =>
      filterAvailableByGrade(availablePlayers, gradeFilter).filter((p) =>
        matchesFilter(p, filterQ)
      ),
    [availablePlayers, gradeFilter, filterQ]
  );

  const unavailableVisible = useMemo(
    () =>
      filterAvailableByGrade(unavailablePlayers, gradeFilter).filter((p) =>
        matchesFilter(p, filterQ)
      ),
    [unavailablePlayers, gradeFilter, filterQ]
  );

  const availableClassCounts = useMemo(
    () => countBySchoolYear(availablePlayers),
    [availablePlayers]
  );

  const unavailableClassCounts = useMemo(
    () => countBySchoolYear(unavailablePlayers),
    [unavailablePlayers]
  );

  const byTeam = useMemo(() => {
    const map: Record<SquadTeam, Player[]> = {
      varsity: [],
      jv: [],
      fr_soph: [],
    };
    for (const p of players) {
      if (isSquadTeam(p.squad_team)) map[p.squad_team].push(p);
    }
    for (const key of Object.keys(map) as SquadTeam[]) {
      map[key] = [...map[key]].sort(comparePlayersByName);
    }
    return map;
  }, [players]);

  const byTeamVisible = useMemo(() => {
    if (!filterQ) return byTeam;
    const map: Record<SquadTeam, Player[]> = {
      varsity: [],
      jv: [],
      fr_soph: [],
    };
    for (const key of Object.keys(map) as SquadTeam[]) {
      map[key] = byTeam[key].filter((p) => matchesFilter(p, filterQ));
    }
    return map;
  }, [byTeam, filterQ]);

  const rankedCount =
    availablePlayers.length + unavailablePlayers.length;

  useEffect(() => {
    if (loading || rankedCount === 0) return;
    void ensureAvailableRanks().catch((e) => {
      console.warn(
        e instanceof Error ? e.message : 'Failed to sync available ranks'
      );
    });
  }, [loading, rankedCount, ensureAvailableRanks]);

  function rankedList(poolKey: RankPool) {
    return poolKey === 'unavailable' ? unavailablePlayers : availablePlayers;
  }

  function rankedVisible(poolKey: RankPool) {
    return poolKey === 'unavailable' ? unavailableVisible : availableVisible;
  }

  function rankedClassCounts(poolKey: RankPool) {
    return poolKey === 'unavailable'
      ? unavailableClassCounts
      : availableClassCounts;
  }

  async function assign(player: Player, team: PlayerAssignment | null) {
    setBusyId(player.id);
    setLocalError(null);
    try {
      await assignSquad(player.id, team);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to update squad');
    } finally {
      setBusyId(null);
    }
  }

  async function runAvailableAction(
    playerId: string,
    action: () => Promise<void>
  ) {
    setBusyId(playerId);
    setLocalError(null);
    try {
      await action();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to update ranking');
    } finally {
      setBusyId(null);
    }
  }

  async function handleMoveAvailable(
    player: Player,
    direction: 'up' | 'down',
    poolKey: RankPool
  ) {
    await runAvailableAction(player.id, () =>
      moveAvailable({
        playerId: player.id,
        direction,
        grade: gradeFilter,
        pool: poolKey,
      })
    );
  }

  async function handleTogglePin(player: Player, poolKey: RankPool) {
    await runAvailableAction(player.id, () =>
      toggleAvailablePin({
        playerId: player.id,
        grade: gradeFilter,
        pool: poolKey,
      })
    );
  }

  async function handleMoveTop(player: Player, poolKey: RankPool) {
    await runAvailableAction(player.id, () =>
      moveAvailableToTop({
        playerId: player.id,
        grade: gradeFilter,
        pool: poolKey,
      })
    );
  }

  async function handleMoveBottom(player: Player, poolKey: RankPool) {
    await runAvailableAction(player.id, () =>
      moveAvailableToBottom({
        playerId: player.id,
        grade: gradeFilter,
        pool: poolKey,
      })
    );
  }

  function confirmResetAvailableOrder(poolKey: RankPool) {
    const list = rankedList(poolKey);
    if (list.length === 0 || sortingPool) return;
    const label = rankPoolLabel(poolKey);
    confirmAction({
      title: `Reset ${label} order?`,
      message:
        'This sorts unstarred players by class (Sr→Fr) then name. Starred players stay at the top in their current order. Your custom ranking of unstarred players will be lost.',
      confirmLabel: 'Sort',
      onConfirm: () => {
        void (async () => {
          setSortingPool(poolKey);
          setLocalError(null);
          try {
            await resetAvailableOrder(poolKey);
          } catch (e) {
            setLocalError(
              e instanceof Error ? e.message : `Failed to sort ${label}`
            );
          } finally {
            setSortingPool(null);
          }
        })();
      },
    });
  }

  const displayError = localError ?? error;

  function dismissError() {
    setLocalError(null);
    clearError();
  }

  function poolPlayers(key: PoolKey): Player[] {
    if (isRankPoolKey(key)) return rankedVisible(key);
    return byTeamVisible[key];
  }

  useEffect(() => {
    const valid = poolTabs.some((t) => t.key === phoneTab);
    if (!valid) setPhoneTab('available');
  }, [poolTabs, phoneTab]);

  function classCountsLine(list: Player[]) {
    return formatClassCounts(list);
  }

  if (!authLoading && (!configured || !session)) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  function renderRankedActions(player: Player, busy: boolean, poolKey: RankPool) {
    const otherPool: PlayerAssignment | null =
      poolKey === 'available' ? UNAVAILABLE_POOL : null;
    const otherLabel = poolKey === 'available' ? 'Unavail' : 'Available';
    return (
      <View style={[styles.actions, isPhone && styles.actionsFill]}>
        {editableSquads.map((teamId) => {
          const label =
            SQUAD_TEAMS.find((t) => t.id === teamId)?.label ?? teamId;
          return (
            <Pressable
              key={teamId}
              style={[
                isPhone ? styles.phonePrimaryBtn : styles.primaryBtn,
                busy && styles.disabled,
              ]}
              disabled={busy}
              onPress={() => void assign(player, teamId)}
            >
              <Text
                style={
                  isPhone ? styles.phonePrimaryBtnText : styles.primaryBtnText
                }
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          style={[
            isPhone ? styles.phoneGhostBtn : styles.ghostBtn,
            busy && styles.disabled,
          ]}
          disabled={busy}
          onPress={() => void assign(player, otherPool)}
        >
          <Text
            style={isPhone ? styles.phoneGhostBtnText : styles.ghostBtnText}
          >
            {otherLabel}
          </Text>
        </Pressable>
      </View>
    );
  }

  function renderTeamActions(
    player: Player,
    current: SquadTeam,
    busy: boolean
  ) {
    const short = tightTeamRows;
    const otherEditable = editableSquads.filter((id) => id !== current);
    return (
      <View
        style={[
          styles.actions,
          (isPhone || tightTeamRows) && styles.actionsFill,
        ]}
      >
        {otherEditable.map((teamId) => (
          <Pressable
            key={teamId}
            style={[
              isPhone
                ? styles.phoneGhostBtn
                : short
                  ? styles.tightGhostBtn
                  : styles.ghostBtn,
              busy && styles.disabled,
            ]}
            disabled={busy}
            onPress={() => void assign(player, teamId)}
          >
            <Text
              style={
                isPhone
                  ? styles.phoneGhostBtnText
                  : short
                    ? styles.tightGhostBtnText
                    : styles.ghostBtnText
              }
            >
              {teamBtnLabel(teamId, short)}
            </Text>
          </Pressable>
        ))}
        <Pressable
          style={[
            isPhone
              ? styles.phoneGhostBtn
              : short
                ? styles.tightGhostBtn
                : styles.ghostBtn,
            busy && styles.disabled,
          ]}
          disabled={busy}
          onPress={() => void assign(player, UNAVAILABLE_POOL)}
        >
          <Text
            style={
              isPhone
                ? styles.phoneGhostBtnText
                : short
                  ? styles.tightGhostBtnText
                  : styles.ghostBtnText
            }
          >
            Unavail
          </Text>
        </Pressable>
        <Pressable
          style={[
            isPhone
              ? styles.phoneRemoveBtn
              : short
                ? styles.tightRemoveBtn
                : styles.removeBtn,
            busy && styles.disabled,
          ]}
          disabled={busy}
          onPress={() => void assign(player, null)}
        >
          <Text
            style={
              isPhone
                ? styles.phoneRemoveBtnText
                : short
                  ? styles.tightRemoveBtnText
                  : styles.removeBtnText
            }
          >
            Remove
          </Text>
        </Pressable>
      </View>
    );
  }

  function renderRankedRow(
    player: Player,
    index: number,
    total: number,
    poolKey: RankPool
  ) {
    const visible = rankedVisible(poolKey);
    const meta = playerMeta(player, {
      omitYear: gradeFilter !== 'all',
    });
    const busy = busyId === player.id;
    const rank = index + 1;
    const pinned = Boolean(player.available_pinned);
    const stacked = isPhone;
    // ↑↓ disabled at band edges (can't cross star boundary).
    const prev = index > 0 ? visible[index - 1] : null;
    const next = index < total - 1 ? visible[index + 1] : null;
    const canUp =
      index > 0 && Boolean(prev?.available_pinned) === pinned;
    const canDown =
      index < total - 1 && Boolean(next?.available_pinned) === pinned;
    const firstUnpinnedIdx = visible.findIndex((p) => !p.available_pinned);
    const canTop = pinned
      ? index > 0
      : firstUnpinnedIdx >= 0 && index > firstUnpinnedIdx;
    const lastPinnedIdx = (() => {
      let last = -1;
      visible.forEach((p, i) => {
        if (p.available_pinned) last = i;
      });
      return last;
    })();
    const canBottom = pinned
      ? index < lastPinnedIdx
      : index < total - 1;

    const present =
      Boolean(roster?.tryout_active) && playerAttendedAnyTryout(player);

    return (
      <View
        key={player.id}
        style={[
          styles.row,
          stacked && styles.stackedRow,
          pinned && styles.rowPinned,
          index % 2 === 1 && !pinned && styles.rowAlt,
          present && styles.rowPresent,
          busy && styles.rowBusy,
        ]}
      >
        <View style={styles.rankCol}>
          <Pressable
            style={[styles.starBtn, pinned && styles.starBtnOn]}
            disabled={busy}
            onPress={() => void handleTogglePin(player, poolKey)}
            hitSlop={6}
            accessibilityLabel={pinned ? 'Unpin from top' : 'Star and lock at top'}
          >
            <Text style={[styles.starBtnText, pinned && styles.starBtnTextOn]}>
              {pinned ? '★' : '☆'}
            </Text>
          </Pressable>
          <Text style={[styles.rankBadge, pinned && styles.rankBadgePinned]}>
            #{rank}
          </Text>
          <View style={styles.moveCol}>
            <Pressable
              style={[styles.moveBtn, !canUp && styles.moveDisabled]}
              disabled={busy || !canUp}
              onPress={() => void handleMoveAvailable(player, 'up', poolKey)}
              hitSlop={4}
            >
              <Text style={styles.moveBtnText}>↑</Text>
            </Pressable>
            <Pressable
              style={[styles.moveBtn, !canDown && styles.moveDisabled]}
              disabled={busy || !canDown}
              onPress={() => void handleMoveAvailable(player, 'down', poolKey)}
              hitSlop={4}
            >
              <Text style={styles.moveBtnText}>↓</Text>
            </Pressable>
          </View>
          <View style={styles.moveCol}>
            <Pressable
              style={[styles.moveBtn, !canTop && styles.moveDisabled]}
              disabled={busy || !canTop}
              onPress={() => void handleMoveTop(player, poolKey)}
              hitSlop={4}
              accessibilityLabel="Move to top of band"
            >
              <Text style={styles.moveBtnText}>⇈</Text>
            </Pressable>
            <Pressable
              style={[styles.moveBtn, !canBottom && styles.moveDisabled]}
              disabled={busy || !canBottom}
              onPress={() => void handleMoveBottom(player, poolKey)}
              hitSlop={4}
              accessibilityLabel="Move to bottom of band"
            >
              <Text style={styles.moveBtnText}>⇊</Text>
            </Pressable>
          </View>
        </View>
        <View style={[styles.playerCell, stacked && styles.playerCellStacked]}>
          <Text style={styles.playerName} numberOfLines={1}>
            {player.last_name}, {player.first_name}
          </Text>
          {meta ? (
            <Text style={styles.playerMeta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        {renderRankedActions(player, busy, poolKey)}
      </View>
    );
  }

  function renderTeamRow(
    player: Player,
    index: number,
    team: SquadTeam
  ) {
    const meta = playerMeta(player);
    const busy = busyId === player.id;
    const stacked = isPhone || tightTeamRows;
    const present =
      Boolean(roster?.tryout_active) && playerAttendedAnyTryout(player);
    return (
      <View
        key={player.id}
        style={[
          styles.row,
          stacked && styles.stackedRow,
          index % 2 === 1 && styles.rowAlt,
          present && styles.rowPresent,
          busy && styles.rowBusy,
        ]}
      >
        <View style={[styles.playerCell, stacked && styles.playerCellStacked]}>
          <Text style={styles.playerName} numberOfLines={1}>
            {player.last_name}, {player.first_name}
          </Text>
          {meta ? (
            <Text style={styles.playerMeta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        {renderTeamActions(player, team, busy)}
      </View>
    );
  }

  function renderRankedPanel(poolKey: RankPool) {
    const all = rankedList(poolKey);
    const visible = rankedVisible(poolKey);
    const classCounts = rankedClassCounts(poolKey);
    const counts = classCountsLine(all);
    const label = rankPoolLabel(poolKey);
    const sorting = sortingPool === poolKey;
    const emptyAll =
      poolKey === 'available'
        ? 'No players in Available.'
        : 'No players in Unavailable.';
    return (
      <View
        style={[
          styles.panel,
          !isPhone && styles.rankedPanel,
        ]}
      >
        <View style={styles.panelHeader}>
          <View style={styles.panelTitleBlock}>
            <Text style={styles.sectionTitle}>{label}</Text>
            {counts ? (
              <Text style={styles.classCounts} numberOfLines={2}>
                {counts}
              </Text>
            ) : null}
          </View>
          <Text style={styles.count}>{visible.length}</Text>
        </View>

        <View style={styles.gradeRow}>
          {GRADE_FILTERS.map((tab) => {
            const active = gradeFilter === tab.key;
            const count =
              tab.key === 'all' ? all.length : classCounts[tab.key];
            return (
              <Pressable
                key={tab.key}
                style={[styles.gradeChip, active && styles.gradeChipActive]}
                onPress={() => setGradeFilter(tab.key)}
              >
                <Text
                  style={[styles.gradeText, active && styles.gradeTextActive]}
                >
                  {tab.key === 'all' ? `All ${count}` : `${tab.label} ${count}`}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            style={[styles.sortBtn, sorting && styles.moveDisabled]}
            disabled={Boolean(sortingPool) || all.length === 0}
            onPress={() => confirmResetAvailableOrder(poolKey)}
          >
            <Text style={styles.sortBtnText}>
              {sorting ? 'Sorting…' : 'Sort'}
            </Text>
          </Pressable>
        </View>

        {visible.length === 0 ? (
          <Text style={styles.empty}>
            {all.length === 0
              ? emptyAll
              : filterQ
                ? `No players match “${filter.trim()}”.`
                : `No ${gradeFilter === 'all' ? '' : gradeFilter + ' '}players in ${label}.`}
          </Text>
        ) : (
          <View style={styles.list}>
            {visible.map((player, index) =>
              renderRankedRow(player, index, visible.length, poolKey)
            )}
          </View>
        )}
      </View>
    );
  }

  function renderTeamPanel(teamId: SquadTeam) {
    const label =
      SQUAD_TEAMS.find((t) => t.id === teamId)?.label ?? teamId;
    const all = byTeam[teamId];
    const list = byTeamVisible[teamId];
    const counts = classCountsLine(all);
    return (
      <View
        key={teamId}
        style={[
          styles.panel,
          styles.teamPanel,
          threeTeamCols && styles.teamPanelThird,
        ]}
      >
        <View style={styles.panelHeader}>
          <View style={styles.panelTitleBlock}>
            <Text style={styles.sectionTitle}>{label}</Text>
            {counts ? (
              <Text style={styles.classCounts} numberOfLines={2}>
                {counts}
              </Text>
            ) : null}
          </View>
          <Text style={styles.count}>{list.length}</Text>
        </View>
        {list.length === 0 ? (
          <Text style={styles.empty}>
            {all.length === 0
              ? 'No players yet'
              : filterQ
                ? `No players match “${filter.trim()}”.`
                : 'No players yet'}
          </Text>
        ) : (
          <View style={styles.list}>
            {list.map((player, index) =>
              renderTeamRow(player, index, teamId)
            )}
          </View>
        )}
      </View>
    );
  }

  const phoneList = poolPlayers(phoneTab);
  const phonePoolCounts = isRankPoolKey(phoneTab)
    ? classCountsLine(rankedList(phoneTab))
    : classCountsLine(byTeam[phoneTab]);

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          isCompact && styles.scrollContentCompact,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <Text style={styles.heading}>
            {roster ? `${roster.name} · Assign Squads` : 'Assign Squads'}
          </Text>
          <Text style={styles.sub}>
            {isPhone
              ? '★ locks at top. ⇈/⇊ jump within band. ↑↓ nudge. Move between Available, Unavailable, and squads.'
              : 'Rank Available and Unavailable (#1 top). Filter by name or grade; Sort resets unstarred order.'}
          </Text>

          <View style={styles.toolbar}>
            <TextInput
              style={[styles.search, isCompact && styles.searchCompact]}
              value={filter}
              onChangeText={setFilter}
              placeholder="Filter players…"
              placeholderTextColor={colors.muted}
            />
            <Pressable
              style={[styles.toolbarPrimaryBtn, !isOnline && styles.btnDisabled]}
              onPress={() => {
                if (!isOnline) {
                  alertRequiresOnline('Adding players');
                  return;
                }
                router.push(`/roster/${rosterId}/add`);
              }}
            >
              <Text style={styles.toolbarPrimaryText}>Add</Text>
            </Pressable>
            {isCompact ? (
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => setMoreOpen((v) => !v)}
              >
                <Text style={styles.secondaryText}>More</Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  style={[styles.secondaryBtn, !isOnline && styles.btnDisabled]}
                  onPress={() => {
                    if (!isOnline) {
                      alertRequiresOnline('Import');
                      return;
                    }
                    router.push(`/roster/${rosterId}/import`);
                  }}
                >
                  <Text style={styles.secondaryText}>Import</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.secondaryBtn,
                    players.length === 0 && styles.btnDisabled,
                  ]}
                  disabled={players.length === 0}
                  onPress={() =>
                    downloadFullPlayersCsv(players, roster?.name ?? 'roster')
                  }
                >
                  <Text style={styles.secondaryText}>Export full</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.secondaryBtn,
                    players.length === 0 && styles.btnDisabled,
                  ]}
                  disabled={players.length === 0}
                  onPress={() =>
                    downloadNamesYearCsv(players, roster?.name ?? 'roster')
                  }
                >
                  <Text style={styles.secondaryText}>Export names</Text>
                </Pressable>
              </>
            )}
          </View>

          {isCompact && moreOpen ? (
            <View style={styles.morePanel}>
              <Pressable
                style={[styles.moreRow, !isOnline && styles.btnDisabled]}
                onPress={() => {
                  if (!isOnline) {
                    alertRequiresOnline('Import');
                    return;
                  }
                  setMoreOpen(false);
                  router.push(`/roster/${rosterId}/import`);
                }}
              >
                <Text style={styles.moreText}>Import</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.moreRow,
                  players.length === 0 && styles.btnDisabled,
                ]}
                disabled={players.length === 0}
                onPress={() => {
                  downloadFullPlayersCsv(players, roster?.name ?? 'roster');
                  setMoreOpen(false);
                }}
              >
                <Text style={styles.moreText}>Export full CSV</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.moreRow,
                  players.length === 0 && styles.btnDisabled,
                ]}
                disabled={players.length === 0}
                onPress={() => {
                  downloadNamesYearCsv(players, roster?.name ?? 'roster');
                  setMoreOpen(false);
                }}
              >
                <Text style={styles.moreText}>Export names CSV</Text>
              </Pressable>
            </View>
          ) : null}

          {displayError ? (
            <Pressable onPress={dismissError} style={styles.errorBanner}>
              <Text style={styles.error}>{displayError}</Text>
              <Text style={styles.errorDismiss}>Dismiss</Text>
            </Pressable>
          ) : null}

          {isPhone ? (
            <>
              <View style={styles.segmentRow}>
                {poolTabs.map((tab) => {
                  const active = phoneTab === tab.key;
                  const count = isRankPoolKey(tab.key)
                    ? rankedVisible(tab.key).length
                    : byTeamVisible[tab.key as SquadTeam].length;
                  return (
                    <Pressable
                      key={tab.key}
                      style={[
                        styles.segmentChip,
                        active && styles.segmentChipActive,
                      ]}
                      onPress={() => setPhoneTab(tab.key)}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          active && styles.segmentTextActive,
                        ]}
                        numberOfLines={1}
                      >
                        {tab.label}
                      </Text>
                      <Text
                        style={[
                          styles.segmentCount,
                          active && styles.segmentTextActive,
                        ]}
                      >
                        {count}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {isRankPoolKey(phoneTab) ? (
                renderRankedPanel(phoneTab)
              ) : isSquadTeam(phoneTab) ? (
                <View style={styles.panel}>
                  <View style={styles.panelHeader}>
                    <View style={styles.panelTitleBlock}>
                      <Text style={styles.sectionTitle}>
                        {poolTabs.find((t) => t.key === phoneTab)?.label}
                      </Text>
                      {phonePoolCounts ? (
                        <Text style={styles.classCounts} numberOfLines={2}>
                          {phonePoolCounts}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.count}>{phoneList.length}</Text>
                  </View>
                  {phoneList.length === 0 ? (
                    <Text style={styles.empty}>
                      {loading
                        ? 'Loading…'
                        : filterQ
                          ? `No players match “${filter.trim()}”.`
                          : 'No players yet'}
                    </Text>
                  ) : (
                    <View style={styles.list}>
                      {phoneList.map((player, index) =>
                        renderTeamRow(player, index, phoneTab)
                      )}
                    </View>
                  )}
                </View>
              ) : null}
            </>
          ) : (
            <>
              <View style={styles.rankedRow}>
                {renderRankedPanel('available')}
                {renderRankedPanel('unavailable')}
              </View>
              <View
                style={[
                  styles.teamsRow,
                  threeTeamCols && styles.teamsRowThree,
                ]}
              >
                {SQUAD_TEAMS.map((team) => renderTeamPanel(team.id))}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: layout.pagePadding,
    paddingTop: 12,
    paddingBottom: 48,
    alignItems: 'center',
  },
  scrollContentCompact: {
    padding: layout.pagePaddingCompact,
    alignItems: 'stretch',
  },
  content: {
    width: '100%',
    maxWidth: 1140,
    gap: 16,
  },
  heading: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  sub: {
    color: colors.muted,
    marginTop: -8,
    fontSize: 14,
    fontWeight: '600',
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  search: {
    flexGrow: 1,
    flexBasis: 180,
    minWidth: 140,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.radius,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
  },
  searchCompact: {
    flexBasis: 120,
  },
  toolbarPrimaryBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: layout.radius,
  },
  toolbarPrimaryText: {
    color: colors.primaryText,
    fontWeight: '800',
    fontSize: 14,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: layout.radius,
  },
  secondaryText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  morePanel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.radius,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  moreRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  moreText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.dangerBg,
    padding: 10,
    borderRadius: layout.radius,
  },
  error: {
    flex: 1,
    color: colors.danger,
    fontWeight: '600',
  },
  errorDismiss: {
    color: colors.danger,
    fontWeight: '800',
    fontSize: 13,
  },
  segmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  segmentChip: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 72,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: layout.radius,
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 2,
  },
  segmentChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
  },
  segmentCount: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
  },
  segmentTextActive: {
    color: colors.primaryText,
  },
  rankedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'stretch',
  },
  rankedPanel: {
    flexGrow: 1,
    flexBasis: 320,
    minWidth: 280,
  },
  panel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  teamPanel: {
    flexGrow: 1,
    flexBasis: 280,
    minWidth: 240,
    minHeight: 140,
  },
  readonlyPanel: {
    backgroundColor: '#f7f8fa',
    opacity: 0.98,
  },
  readonlyHint: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
  },
  teamPanelThird: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: '#e8eef3',
  },
  panelTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  sectionTitle: {
    fontWeight: '800',
    fontSize: 15,
    color: colors.text,
  },
  classCounts: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
  },
  count: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  sortBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
  gradeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: '#f7f9fb',
  },
  gradeChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  gradeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  gradeText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
  },
  gradeTextActive: {
    color: colors.primaryText,
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  list: {
    borderTopWidth: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  stackedRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
    paddingVertical: 12,
  },
  rowAlt: {
    backgroundColor: '#f7f9fb',
  },
  rowPinned: {
    backgroundColor: '#fff8e8',
  },
  rowPresent: {
    backgroundColor: colors.tryoutPresentBg,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  rowBusy: {
    opacity: 0.55,
  },
  rankCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  starBtn: {
    minWidth: 32,
    minHeight: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fbfcfd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  starBtnOn: {
    borderColor: '#e0c36a',
    backgroundColor: colors.warningBg,
  },
  starBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.muted,
  },
  starBtnTextOn: {
    color: '#c9a227',
  },
  rankBadge: {
    minWidth: 28,
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
  },
  rankBadgePinned: {
    color: '#7a5b00',
  },
  moveCol: {
    gap: 3,
  },
  moveBtn: {
    minWidth: 32,
    minHeight: 28,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: '#fbfcfd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveDisabled: {
    opacity: 0.35,
  },
  moveBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  playerCell: {
    flex: 1,
    minWidth: 100,
    gap: 2,
  },
  playerCellStacked: {
    minWidth: 0,
    width: '100%',
  },
  playerName: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  playerMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-end',
    flexShrink: 0,
  },
  actionsFill: {
    width: '100%',
    justifyContent: 'flex-start',
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  primaryBtnText: {
    color: colors.primaryText,
    fontWeight: '700',
    fontSize: 12,
  },
  phonePrimaryBtn: {
    flexGrow: 1,
    flexBasis: '30%',
    backgroundColor: colors.primary,
    borderRadius: layout.radius,
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  phonePrimaryBtnText: {
    color: colors.primaryText,
    fontWeight: '800',
    fontSize: 13,
  },
  ghostBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  ghostBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
  },
  phoneGhostBtn: {
    flexGrow: 1,
    flexBasis: '30%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.radius,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  phoneGhostBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  removeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  removeBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.danger,
  },
  tightGhostBtn: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  tightGhostBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
  },
  tightRemoveBtn: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: colors.dangerBg,
  },
  tightRemoveBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.danger,
  },
  phoneRemoveBtn: {
    flexGrow: 1,
    flexBasis: '30%',
    borderRadius: layout.radius,
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.dangerBg,
  },
  phoneRemoveBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.danger,
  },
  disabled: {
    opacity: 0.5,
  },
  teamsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  teamsRowThree: {
    flexWrap: 'nowrap',
    alignItems: 'stretch',
  },
});
