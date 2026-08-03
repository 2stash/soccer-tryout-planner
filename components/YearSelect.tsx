import { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SCHOOL_YEARS } from '@/lib/schoolYear';
import { colors } from '@/constants/theme';

type Props = {
  value: string;
  onChange: (value: string) => void;
  style?: object;
};

export function YearSelect({ value, onChange, style }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        style={[styles.btn, style]}
        onPress={() => setOpen(true)}
      >
        <Text style={[styles.btnText, !value && styles.placeholder]} numberOfLines={1}>
          {value || '—'}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>School year</Text>
            <Pressable
              style={styles.option}
              onPress={() => {
                onChange('');
                setOpen(false);
              }}
            >
              <Text style={styles.optionText}>—</Text>
            </Pressable>
            {SCHOOL_YEARS.map((year) => (
              <Pressable
                key={year}
                style={styles.option}
                onPress={() => {
                  onChange(year);
                  setOpen(false);
                }}
              >
                <Text style={[styles.optionText, value === year && styles.optionSelected]}>
                  {year}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
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
  btnText: {
    fontSize: 14,
    color: colors.text,
  },
  placeholder: {
    color: colors.muted,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 8,
    maxWidth: 360,
    width: '100%',
    alignSelf: 'center',
  },
  sheetTitle: {
    fontWeight: '700',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.text,
  },
  option: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  optionText: {
    fontSize: 16,
    color: colors.text,
  },
  optionSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
});
