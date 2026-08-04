import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { OfflineConflictChoice } from '@/lib/offline/OfflineContext';
import { colors, layout } from '@/constants/theme';

type Step = 'choose' | 'confirm';

type Props = {
  visible: boolean;
  rosterName: string;
  busy: boolean;
  error: string | null;
  onResolve: (choice: OfflineConflictChoice) => void;
};

const CHOICES: {
  id: OfflineConflictChoice;
  title: string;
  body: string;
  confirm: string;
}[] = [
  {
    id: 'keep_device',
    title: 'Keep my device data',
    body: 'Push this device’s offline changes to the shared team on the server.',
    confirm:
      'Overwrite the shared team on the server with this device’s changes? This cannot be undone.',
  },
  {
    id: 'use_supabase',
    title: 'Use Supabase data',
    body: 'Discard offline changes on this device and load the server team.',
    confirm:
      'Discard offline changes on this device and load Supabase data? Your local edits will be lost.',
  },
  {
    id: 'use_supabase_and_copy',
    title: 'Use Supabase + copy offline work',
    body: 'Load server data on this team, and save your offline work as a new team (you will be Admin).',
    confirm:
      'Load server data onto this team and create a new team from your offline snapshot? You will be Admin of the copy.',
  },
];

export function OfflineConflictModal({
  visible,
  rosterName,
  busy,
  error,
  onResolve,
}: Props) {
  const [step, setStep] = useState<Step>('choose');
  const [pending, setPending] = useState<OfflineConflictChoice | null>(null);

  useEffect(() => {
    if (!visible) {
      setStep('choose');
      setPending(null);
    }
  }, [visible]);

  function reset() {
    setStep('choose');
    setPending(null);
  }

  function select(choice: OfflineConflictChoice) {
    setPending(choice);
    setStep('confirm');
  }

  const confirmCopy = CHOICES.find((c) => c.id === pending);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        /* must choose — do not dismiss */
      }}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Offline changes found</Text>
          <Text style={styles.sub}>
            {rosterName
              ? `${rosterName} has edits on this device that haven’t synced.`
              : 'This team has edits on this device that haven’t synced.'}{' '}
            Choose what to keep.
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {busy ? (
            <View style={styles.busyBox}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.busyText}>Working…</Text>
            </View>
          ) : step === 'choose' ? (
            <View style={styles.choices}>
              {CHOICES.map((c) => (
                <Pressable
                  key={c.id}
                  style={styles.choice}
                  onPress={() => select(c.id)}
                >
                  <Text style={styles.choiceTitle}>{c.title}</Text>
                  <Text style={styles.choiceBody}>{c.body}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.confirmBox}>
              <Text style={styles.confirmText}>
                {confirmCopy?.confirm ?? 'Are you sure?'}
              </Text>
              <View style={styles.actions}>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={reset}
                  disabled={busy}
                >
                  <Text style={styles.secondaryText}>Back</Text>
                </Pressable>
                <Pressable
                  style={styles.primaryBtn}
                  onPress={() => {
                    if (pending) onResolve(pending);
                  }}
                  disabled={busy || !pending}
                >
                  <Text style={styles.primaryText}>Confirm</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'rgba(21, 32, 43, 0.45)',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colors.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: layout.pagePaddingCompact,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  sub: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  error: {
    color: colors.danger,
    fontWeight: '600',
  },
  choices: {
    gap: 8,
  },
  choice: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
    padding: 12,
    gap: 4,
  },
  choiceTitle: {
    fontWeight: '800',
    color: colors.text,
    fontSize: 15,
  },
  choiceBody: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  confirmBox: {
    gap: 14,
  },
  confirmText: {
    color: colors.text,
    fontWeight: '600',
    lineHeight: 21,
    fontSize: 15,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryText: {
    color: colors.text,
    fontWeight: '700',
  },
  primaryBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  primaryText: {
    color: colors.primaryText,
    fontWeight: '700',
  },
  busyBox: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 20,
  },
  busyText: {
    color: colors.muted,
    fontWeight: '600',
  },
});
