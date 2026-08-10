import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { confirmAction } from '@/lib/confirm';
import { useRosterData } from '@/lib/RosterDataContext';
import { useLayout } from '@/lib/layout';
import { comparePlayersByName } from '@/lib/playerSort';
import type { Player } from '@/lib/types';
import { colors, layout } from '@/constants/theme';

const MINUTE_OPTIONS = Array.from({ length: 100 }, (_, i) => i);
const SECOND_OPTIONS = Array.from({ length: 60 }, (_, i) => i);

function dayRow(player: Player, day: number) {
  return player.tryout_days?.find((d) => d.day === day);
}

/** Format elapsed ms as m:ss (whole seconds). */
function formatTimeTrialMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function msToParts(ms: number): { minutes: number; seconds: number } {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  return {
    minutes: Math.min(99, Math.floor(totalSec / 60)),
    seconds: totalSec % 60,
  };
}

function partsToMs(minutes: number, seconds: number): number {
  return Math.max(0, minutes) * 60_000 + Math.max(0, seconds) * 1000;
}

function sortByNumberThenName(list: Player[], day: number): Player[] {
  return [...list].sort((a, b) => {
    const na = dayRow(a, day)?.tryout_number;
    const nb = dayRow(b, day)?.tryout_number;
    if (na == null && nb == null) return comparePlayersByName(a, b);
    if (na == null) return 1;
    if (nb == null) return -1;
    if (na !== nb) return na - nb;
    return comparePlayersByName(a, b);
  });
}

type EditState = {
  player: Player;
  /** Clock reading when long-press opened the editor while running. */
  captureMs: number | null;
  minutes: number;
  seconds: number;
};

function TimeColumn({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.pickerCol}>
      <Text style={styles.pickerLabel}>{label}</Text>
      <ScrollView
        style={styles.pickerScroll}
        contentContainerStyle={styles.pickerScrollContent}
        showsVerticalScrollIndicator
      >
        {options.map((n) => {
          const active = value === n;
          return (
            <Pressable
              key={n}
              style={[styles.pickerChip, active && styles.pickerChipActive]}
              disabled={disabled}
              onPress={() => onChange(n)}
            >
              <Text
                style={[styles.pickerChipText, active && styles.pickerChipTextActive]}
              >
                {String(n).padStart(2, '0')}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function TimeTrialScreen() {
  const { session, loading: authLoading, configured } = useAuth();
  const { isCompact } = useLayout();
  const {
    rosterId,
    roster,
    players,
    loading,
    error,
    clearError,
    setTryoutTimeTrial,
    clearTryoutDayTimes,
    timeTrialDay,
    timeTrialStartedAt,
    timeTrialStoppedAt,
    setTimeTrialDay,
    startTimeTrialClock,
    endTimeTrialClock,
    clearTimeTrialClock,
  } = useRosterData();

  const dayCount = Math.min(5, Math.max(1, roster?.tryout_day_count ?? 1));
  const day = Math.min(dayCount, Math.max(1, timeTrialDay));
  const [showPresentOnly, setShowPresentOnly] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [localError, setLocalError] = useState<string | null>(null);
  const [finishingId, setFinishingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [manualBusy, setManualBusy] = useState(false);

  const running =
    timeTrialStartedAt != null && timeTrialStoppedAt == null;

  useEffect(() => {
    if (timeTrialDay > dayCount) setTimeTrialDay(1);
  }, [timeTrialDay, dayCount, setTimeTrialDay]);

  useEffect(() => {
    if (!loading && roster && !roster.tryout_active) {
      router.replace(`/roster/${rosterId}/players`);
    }
  }, [loading, roster, rosterId]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  const elapsedMs =
    timeTrialStartedAt == null
      ? 0
      : (timeTrialStoppedAt ?? now) - timeTrialStartedAt;

  const ordered = useMemo(() => {
    let list = players;
    if (showPresentOnly) {
      list = list.filter((p) => dayRow(p, day)?.attended);
    }
    return sortByNumberThenName(list, day);
  }, [players, day, showPresentOnly]);

  const displayError = localError ?? error;

  function dismissError() {
    setLocalError(null);
    clearError();
  }

  async function saveTime(playerId: string, ms: number) {
    setFinishingId(playerId);
    setLocalError(null);
    try {
      await setTryoutTimeTrial(playerId, day, ms);
    } catch (e) {
      setLocalError(
        e instanceof Error ? e.message : 'Failed to save finish time'
      );
      throw e;
    } finally {
      setFinishingId(null);
    }
  }

  async function handleFinish(player: Player) {
    if (!running || timeTrialStartedAt == null) return;
    if (dayRow(player, day)?.time_trial_ms != null) return;
    const ms = Math.max(0, Date.now() - timeTrialStartedAt);
    // Store whole seconds only.
    await saveTime(player.id, Math.floor(ms / 1000) * 1000);
  }

  function openEditor(
    player: Player,
    opts?: { captureMs?: number | null }
  ) {
    const saved = dayRow(player, day)?.time_trial_ms;
    const captureMs =
      opts && 'captureMs' in opts ? (opts.captureMs ?? null) : null;
    const seedMs =
      captureMs != null
        ? captureMs
        : saved != null
          ? saved
          : 0;
    const parts = msToParts(seedMs);
    setEdit({
      player,
      captureMs,
      minutes: parts.minutes,
      seconds: parts.seconds,
    });
  }

  function onCardPress(player: Player) {
    if (running) {
      void handleFinish(player);
      return;
    }
    openEditor(player);
  }

  function onCardLongPress(player: Player) {
    if (running && timeTrialStartedAt != null) {
      const captureMs = Math.max(
        0,
        Math.floor((Date.now() - timeTrialStartedAt) / 1000) * 1000
      );
      openEditor(player, { captureMs });
      return;
    }
    openEditor(player);
  }

  function confirmClear() {
    confirmAction({
      title: 'Clear time trial?',
      message:
        'This resets the timer to 0:00 and clears all saved times for this day. This cannot be undone.',
      confirmLabel: 'Clear',
      onConfirm: () => {
        void (async () => {
          setLocalError(null);
          clearTimeTrialClock();
          setNow(Date.now());
          try {
            await clearTryoutDayTimes(day);
          } catch (e) {
            setLocalError(
              e instanceof Error ? e.message : 'Failed to clear times'
            );
          }
        })();
      },
    });
  }

  async function saveEdit(ms: number) {
    if (!edit) return;
    setManualBusy(true);
    setLocalError(null);
    try {
      await setTryoutTimeTrial(edit.player.id, day, ms);
      setEdit(null);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to save time');
    } finally {
      setManualBusy(false);
    }
  }

  if (!authLoading && (!configured || !session)) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (!loading && roster && !roster.tryout_active) {
    return <Redirect href={`/roster/${rosterId}/players`} />;
  }

  const dayOptions = Array.from({ length: dayCount }, (_, i) => i + 1);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, isCompact && styles.headerCompact]}>
        <View style={styles.titleRow}>
          <Text style={styles.heading} numberOfLines={1}>
            Time Trial
          </Text>
          <Pressable
            style={[
              styles.presentBtn,
              showPresentOnly && styles.presentBtnActive,
            ]}
            onPress={() => setShowPresentOnly((v) => !v)}
          >
            <Text
              style={[
                styles.presentBtnText,
                showPresentOnly && styles.presentBtnTextActive,
              ]}
            >
              {showPresentOnly ? 'Show All' : 'Show Present'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.dayRow}>
          {dayOptions.map((d) => {
            const active = day === d;
            return (
              <Pressable
                key={d}
                style={[styles.dayChip, active && styles.dayChipActive]}
                onPress={() => setTimeTrialDay(d)}
              >
                <Text
                  style={[styles.dayText, active && styles.dayTextActive]}
                >
                  Day {d}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.clockRow}>
          <Text style={styles.clock}>{formatTimeTrialMs(elapsedMs)}</Text>
          <View style={styles.timerActions}>
            <Pressable
              style={[styles.startBtn, running && styles.btnDisabled]}
              disabled={running}
              onPress={startTimeTrialClock}
            >
              <Text style={styles.startBtnText}>
                {timeTrialStartedAt != null && !running ? 'Restart' : 'Start'}
              </Text>
            </Pressable>
            {running ? (
              <Pressable style={styles.endBtn} onPress={endTimeTrialClock}>
                <Text style={styles.endBtnText}>End</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.clearBtn} onPress={confirmClear}>
                <Text style={styles.clearBtnText}>Clear</Text>
              </Pressable>
            )}
          </View>
        </View>
        <Text style={styles.clockHint}>
          {running
            ? 'Tap unset players to finish · long-press to fix a time'
            : 'Tap a player to set time · Clear resets timer and day’s times'}
        </Text>
      </View>

      {displayError ? (
        <Pressable onPress={dismissError} style={styles.errorBanner}>
          <Text style={styles.error}>{displayError}</Text>
          <Text style={styles.errorDismiss}>Dismiss</Text>
        </Pressable>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          isCompact && styles.scrollContentCompact,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {loading && players.length === 0 ? (
          <Text style={styles.empty}>Loading players…</Text>
        ) : ordered.length === 0 ? (
          <Text style={styles.empty}>
            {showPresentOnly
              ? 'No present players for this day. Turn off Show Present or mark attendance on Tryout.'
              : 'No players on this roster.'}
          </Text>
        ) : (
          <View style={styles.grid}>
            {ordered.map((player) => {
              const row = dayRow(player, day);
              const num = row?.tryout_number;
              const saved = row?.time_trial_ms;
              const finished = saved != null;
              const busy = finishingId === player.id;
              return (
                <Pressable
                  key={player.id}
                  style={[
                    styles.tile,
                    finished && styles.tileFinished,
                    busy && styles.tileBusy,
                  ]}
                  disabled={busy}
                  onPress={() => onCardPress(player)}
                  onLongPress={() => onCardLongPress(player)}
                  delayLongPress={350}
                >
                  <Text style={styles.tileNum} numberOfLines={1}>
                    {num != null ? `#${num}` : '#—'}
                  </Text>
                  <Text style={styles.tileName} numberOfLines={1}>
                    {player.first_name || '—'}
                  </Text>
                  <Text style={styles.tileTime} numberOfLines={1}>
                    {busy
                      ? '…'
                      : saved != null
                        ? formatTimeTrialMs(saved)
                        : '—'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={Boolean(edit)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!manualBusy) setEdit(null);
        }}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => {
            if (!manualBusy) setEdit(null);
          }}
        >
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Set time</Text>
            <Text style={styles.modalSub} numberOfLines={1}>
              {edit
                ? `#${dayRow(edit.player, day)?.tryout_number ?? '—'} ${edit.player.first_name} ${edit.player.last_name}`
                : ''}
            </Text>

            {edit?.captureMs != null ? (
              <Pressable
                style={[styles.useCaptureBtn, manualBusy && styles.btnDisabled]}
                disabled={manualBusy}
                onPress={() => void saveEdit(edit.captureMs!)}
              >
                <Text style={styles.useCaptureLabel}>Use this time</Text>
                <Text style={styles.useCaptureValue}>
                  {formatTimeTrialMs(edit.captureMs)}
                </Text>
              </Pressable>
            ) : null}

            <Text style={styles.pickerHeading}>Minutes · Seconds</Text>
            <View style={styles.pickerRow}>
              <TimeColumn
                label="Min"
                value={edit?.minutes ?? 0}
                options={MINUTE_OPTIONS}
                disabled={manualBusy}
                onChange={(minutes) =>
                  setEdit((prev) => (prev ? { ...prev, minutes } : prev))
                }
              />
              <Text style={styles.pickerColon}>:</Text>
              <TimeColumn
                label="Sec"
                value={edit?.seconds ?? 0}
                options={SECOND_OPTIONS}
                disabled={manualBusy}
                onChange={(seconds) =>
                  setEdit((prev) => (prev ? { ...prev, seconds } : prev))
                }
              />
            </View>

            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancel}
                disabled={manualBusy}
                onPress={() => setEdit(null)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalSave, manualBusy && styles.btnDisabled]}
                disabled={manualBusy || !edit}
                onPress={() => {
                  if (!edit) return;
                  void saveEdit(partsToMs(edit.minutes, edit.seconds));
                }}
              >
                <Text style={styles.modalSaveText}>
                  {manualBusy ? 'Saving…' : 'Save'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: layout.pagePadding,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    maxWidth: layout.pageMaxWidth,
    width: '100%',
    alignSelf: 'center',
  },
  headerCompact: {
    paddingHorizontal: layout.pagePaddingCompact,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  heading: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  presentBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  presentBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  presentBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
  },
  presentBtnTextActive: {
    color: colors.primaryText,
  },
  dayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dayChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  dayChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  dayTextActive: {
    color: colors.primaryText,
  },
  clockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  clock: {
    fontSize: 36,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
    minWidth: 100,
  },
  clockHint: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  timerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  startBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: layout.radius,
    minWidth: 72,
    alignItems: 'center',
  },
  startBtnText: {
    color: colors.primaryText,
    fontWeight: '800',
    fontSize: 13,
  },
  endBtn: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.danger,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: layout.radius,
    minWidth: 64,
    alignItems: 'center',
  },
  endBtnText: {
    color: colors.danger,
    fontWeight: '800',
    fontSize: 13,
  },
  clearBtn: {
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: '#d4b24c',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: layout.radius,
    minWidth: 64,
    alignItems: 'center',
  },
  clearBtnText: {
    color: colors.warningText,
    fontWeight: '800',
    fontSize: 13,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.dangerBg,
    padding: 10,
    marginHorizontal: layout.pagePaddingCompact,
    marginTop: 8,
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: layout.pagePadding,
    paddingTop: 10,
    paddingBottom: 48,
  },
  scrollContentCompact: {
    padding: layout.pagePaddingCompact,
    paddingTop: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tile: {
    width: '23%',
    flexBasis: '23%',
    flexGrow: 0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: 'center',
    gap: 1,
  },
  tileFinished: {
    backgroundColor: colors.tryoutPresentBg,
    borderColor: '#9cc4b3',
  },
  tileBusy: {
    opacity: 0.55,
  },
  tileNum: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  tileName: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    maxWidth: '100%',
  },
  tileTime: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
    paddingVertical: 16,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 32, 0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 10,
    maxWidth: 360,
    width: '100%',
    alignSelf: 'center',
    maxHeight: '85%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  modalSub: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  useCaptureBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.tryoutPresentBg,
    borderRadius: layout.radius,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 2,
  },
  useCaptureLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  useCaptureValue: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  pickerHeading: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 4,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  pickerColon: {
    alignSelf: 'center',
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    paddingTop: 18,
  },
  pickerCol: {
    flex: 1,
    gap: 6,
  },
  pickerLabel: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
  },
  pickerScroll: {
    maxHeight: 180,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.radius,
    backgroundColor: colors.bg,
  },
  pickerScrollContent: {
    padding: 6,
    gap: 4,
  },
  pickerChip: {
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  pickerChipActive: {
    backgroundColor: colors.primary,
  },
  pickerChipText: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  pickerChipTextActive: {
    color: colors.primaryText,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  modalCancel: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  modalCancelText: {
    fontWeight: '700',
    color: colors.text,
  },
  modalSave: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: layout.radius,
  },
  modalSaveText: {
    fontWeight: '800',
    color: colors.primaryText,
  },
});
