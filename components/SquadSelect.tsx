import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useActiveRole } from '@/lib/ActiveRoleContext';
import { isMasterKind } from '@/lib/masterConflicts';
import { ownSquadForWorkspace } from '@/lib/masterWorkspace';
import type { PlayerAssignment, SquadTeam } from '@/lib/types';
import { SQUAD_TEAMS, UNAVAILABLE_POOL } from '@/lib/types';
import { colors } from '@/constants/theme';

type Props = {
  value: PlayerAssignment | null;
  onChange: (value: PlayerAssignment | null) => void;
  style?: object;
  disabled?: boolean;
};

function labelFor(value: PlayerAssignment | null) {
  if (!value) return 'Available';
  if (value === UNAVAILABLE_POOL) return 'Unavailable';
  return SQUAD_TEAMS.find((t) => t.id === value)?.label ?? value;
}

export function SquadSelect({ value, onChange, style, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const { workspaceKind } = useActiveRole();
  const ownSquad = ownSquadForWorkspace(workspaceKind);
  const squadOptions = useMemo((): SquadTeam[] => {
    if (workspaceKind && isMasterKind(workspaceKind) && ownSquad) {
      return [ownSquad];
    }
    return SQUAD_TEAMS.map((t) => t.id);
  }, [workspaceKind, ownSquad]);

  return (
    <>
      <Pressable
        style={[styles.btn, disabled && styles.disabled, style]}
        onPress={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        <Text
          style={[styles.btnText, !value && styles.placeholder]}
          numberOfLines={1}
        >
          {labelFor(value)}
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
            {squadOptions.map((teamId) => {
              const team = SQUAD_TEAMS.find((t) => t.id === teamId);
              return (
                <Pressable
                  key={teamId}
                  style={styles.option}
                  onPress={() => {
                    onChange(teamId);
                    setOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.optionText,
                      value === teamId && styles.optionSelected,
                    ]}
                  >
                    {team?.label ?? teamId}
                  </Text>
                </Pressable>
              );
            })}
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
    fontWeight: '600',
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
