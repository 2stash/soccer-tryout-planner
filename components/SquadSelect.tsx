import { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { PlayerAssignment } from '@/lib/types';
import { SQUAD_TEAMS, UNAVAILABLE_POOL } from '@/lib/types';
import { colors } from '@/constants/theme';

type Props = {
  value: PlayerAssignment | null;
  onChange: (value: PlayerAssignment | null) => void;
  style?: object;
  disabled?: boolean;
  /** Shorter closed-button labels (e.g. Varsity → Var). */
  compact?: boolean;
};

function labelFor(value: PlayerAssignment | null, compact?: boolean) {
  if (!value) return compact ? 'Avail' : 'Available';
  if (value === UNAVAILABLE_POOL) return compact ? 'Unavail' : 'Unavailable';
  const team = SQUAD_TEAMS.find((t) => t.id === value);
  if (!team) return value;
  return compact ? team.shortLabel : team.label;
}

export function SquadSelect({
  value,
  onChange,
  style,
  disabled,
  compact,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        style={[
          styles.btn,
          compact && styles.btnCompact,
          disabled && styles.disabled,
          style,
        ]}
        onPress={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        <Text
          style={[
            styles.btnText,
            compact && styles.btnTextCompact,
            !value && styles.placeholder,
          ]}
          numberOfLines={1}
        >
          {labelFor(value, compact)}
        </Text>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Team</Text>
            <Pressable
              style={styles.option}
              onPress={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <Text
                style={[styles.optionText, value == null && styles.optionSelected]}
              >
                Available
              </Text>
            </Pressable>
            <Pressable
              style={styles.option}
              onPress={() => {
                onChange(UNAVAILABLE_POOL);
                setOpen(false);
              }}
            >
              <Text
                style={[
                  styles.optionText,
                  value === UNAVAILABLE_POOL && styles.optionSelected,
                ]}
              >
                Unavailable
              </Text>
            </Pressable>
            {SQUAD_TEAMS.map((team) => (
              <Pressable
                key={team.id}
                style={styles.option}
                onPress={() => {
                  onChange(team.id);
                  setOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.optionText,
                    value === team.id && styles.optionSelected,
                  ]}
                >
                  {team.label}
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
  btnCompact: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    minHeight: 32,
  },
  btnText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
  },
  btnTextCompact: {
    fontSize: 13,
  },
  placeholder: {
    color: colors.muted,
    fontWeight: '500',
  },
  disabled: {
    opacity: 0.5,
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
