import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SOCCER_POSITIONS,
  formatPositionsShort,
  sortPositionNumbers,
} from '@/lib/positions';
import { colors } from '@/constants/theme';

type Props = {
  value: number[];
  onChange: (value: number[]) => void;
  style?: object;
  compact?: boolean;
};

/** One picker row per abbreviation (CB covers both shirt numbers). */
const POSITION_OPTIONS: { abbr: string; name: string; numbers: number[] }[] = [];
for (const pos of SOCCER_POSITIONS) {
  const existing = POSITION_OPTIONS.find((o) => o.abbr === pos.abbr);
  if (existing) {
    existing.numbers.push(pos.number);
  } else {
    POSITION_OPTIONS.push({
      abbr: pos.abbr,
      name: pos.name,
      numbers: [pos.number],
    });
  }
}

export function PositionSelect({ value, onChange, style, compact }: Props) {
  const [open, setOpen] = useState(false);
  const selected = sortPositionNumbers(value);
  const label = formatPositionsShort(selected);

  function toggle(option: { numbers: number[] }) {
    const allSelected = option.numbers.every((n) => selected.includes(n));
    if (allSelected) {
      onChange(selected.filter((n) => !option.numbers.includes(n)));
    } else {
      onChange(sortPositionNumbers([...selected, ...option.numbers]));
    }
  }

  return (
    <>
      <Pressable style={[styles.btn, compact && styles.btnCompact, style]} onPress={() => setOpen(true)}>
        <Text
          style={[styles.btnText, !label && styles.placeholder]}
          numberOfLines={compact ? 2 : 3}
        >
          {label || 'Select positions'}
        </Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <Text style={styles.title}>Positions</Text>
            <Text style={styles.hint}>Tap to select multiple.</Text>
            <ScrollView style={styles.list}>
              {POSITION_OPTIONS.map((option) => {
                const active = option.numbers.some((n) => selected.includes(n));
                return (
                  <Pressable
                    key={option.abbr}
                    style={[styles.option, active && styles.optionActive]}
                    onPress={() => toggle(option)}
                  >
                    <View style={styles.optionBody}>
                      <Text style={[styles.optionAbbr, active && styles.optionTextActive]}>
                        {option.abbr}
                      </Text>
                      <Text style={[styles.optionName, active && styles.optionTextActive]}>
                        {option.name}
                      </Text>
                    </View>
                    <Text style={[styles.check, active && styles.optionTextActive]}>
                      {active ? '✓' : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable style={styles.doneBtn} onPress={() => setOpen(false)}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: '#fbfcfd',
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 0,
  },
  btnCompact: {
    minHeight: 36,
  },
  btnText: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '600',
  },
  placeholder: {
    color: colors.muted,
    fontWeight: '500',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    maxHeight: '85%',
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
    paddingBottom: 12,
  },
  title: {
    fontWeight: '800',
    fontSize: 18,
    paddingHorizontal: 16,
    paddingTop: 16,
    color: colors.text,
  },
  hint: {
    color: colors.muted,
    paddingHorizontal: 16,
    paddingBottom: 8,
    fontSize: 13,
  },
  list: {
    maxHeight: 420,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  optionActive: {
    backgroundColor: '#e8f5ef',
  },
  optionBody: {
    flex: 1,
    gap: 2,
  },
  optionAbbr: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  optionName: {
    fontSize: 13,
    color: colors.muted,
  },
  optionTextActive: {
    color: colors.primary,
  },
  check: {
    width: 20,
    fontWeight: '800',
    color: colors.primary,
    fontSize: 16,
  },
  doneBtn: {
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  doneText: {
    color: colors.primaryText,
    fontWeight: '700',
  },
});
