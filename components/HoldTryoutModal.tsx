import { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, layout } from '@/constants/theme';

type Props = {
  visible: boolean;
  busy?: boolean;
  onCancel: () => void;
  onBegin: (dayCount: number) => void | Promise<void>;
};

const DAY_OPTIONS = [1, 2, 3, 4, 5] as const;

export function HoldTryoutModal({
  visible,
  busy,
  onCancel,
  onBegin,
}: Props) {
  const [dayCount, setDayCount] = useState<number>(3);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Hold tryouts</Text>
          <Text style={styles.sub}>
            How many tryout days? You can track attendance and bib numbers for
            each day.
          </Text>

          <Text style={styles.label}>Days</Text>
          <View style={styles.dayRow}>
            {DAY_OPTIONS.map((n) => {
              const active = dayCount === n;
              return (
                <Pressable
                  key={n}
                  style={[styles.dayChip, active && styles.dayChipActive]}
                  disabled={busy}
                  onPress={() => setDayCount(n)}
                >
                  <Text
                    style={[styles.dayText, active && styles.dayTextActive]}
                  >
                    {n}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.actions}>
            <Pressable
              style={[styles.btn, styles.cancelBtn]}
              disabled={busy}
              onPress={onCancel}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.beginBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void onBegin(dayCount)}
            >
              <Text style={styles.beginText}>
                {busy ? 'Starting…' : 'Begin'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 32, 0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 12,
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  sub: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  label: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 4,
  },
  dayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dayChip: {
    minWidth: 48,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  dayChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  dayTextActive: {
    color: colors.primaryText,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  btn: {
    borderRadius: layout.radius,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cancelText: {
    fontWeight: '700',
    color: colors.text,
  },
  beginBtn: {
    backgroundColor: colors.primary,
  },
  beginText: {
    fontWeight: '800',
    color: colors.primaryText,
  },
  disabled: {
    opacity: 0.55,
  },
});
