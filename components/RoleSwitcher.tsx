import { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  useActiveRole,
  type AdminEditMode,
} from '@/lib/ActiveRoleContext';
import type { RosterRole } from '@/lib/types';
import { colors } from '@/constants/theme';

export function RoleSwitcher() {
  const {
    roles,
    activeRole,
    setActiveRole,
    roleLabel,
    loading,
    workspaceLabel,
    isAdmin,
    adminEditMode,
    setAdminEditMode,
  } = useActiveRole();
  const [open, setOpen] = useState(false);

  const showAdminModes = isAdmin && activeRole === 'admin';
  const canOpen =
    roles.length > 1 || (isAdmin && roles.includes('admin'));

  if (loading || roles.length === 0) {
    return (
      <Text style={styles.actingMuted} numberOfLines={1}>
        {loading ? 'Role…' : 'No role'}
      </Text>
    );
  }

  if (!canOpen && activeRole) {
    return (
      <Text style={styles.acting} numberOfLines={1}>
        {workspaceLabel}
      </Text>
    );
  }

  function pick(role: RosterRole) {
    setActiveRole(role);
    if (role !== 'admin') {
      setOpen(false);
    }
  }

  function pickAdminMode(mode: AdminEditMode) {
    setActiveRole('admin');
    setAdminEditMode(mode);
    setOpen(false);
  }

  return (
    <>
      <Pressable style={styles.btn} onPress={() => setOpen(true)}>
        <Text style={styles.btnLabel}>Acting as</Text>
        <Text style={styles.btnValue} numberOfLines={2}>
          {workspaceLabel || 'Select'}
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
            <Text style={styles.sheetTitle}>Act as</Text>
            <Text style={styles.sheetHint}>
              Head-coach roles edit that master. Admin Personal is a test
              overlay; Live coaches edits all three head-coach rosters at once.
            </Text>
            {roles.map((role) => {
              const isAdminRole = role === 'admin';
              const selected = role === activeRole && !isAdminRole;
              const adminActive = isAdminRole && activeRole === 'admin';
              return (
                <View key={role}>
                  <Pressable
                    style={[
                      styles.option,
                      selected && styles.optionOn,
                      adminActive && styles.optionAdminOpen,
                    ]}
                    onPress={() => pick(role)}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        selected && styles.optionTextOn,
                        adminActive && styles.optionTextAdmin,
                      ]}
                    >
                      {roleLabel(role)}
                    </Text>
                  </Pressable>
                  {isAdminRole && (adminActive || showAdminModes) ? (
                    <View style={styles.modeGroup}>
                      {(
                        [
                          {
                            mode: 'personal' as const,
                            label: 'Personal (test)',
                            hint: 'Scratch overlay — does not change coaches',
                          },
                          {
                            mode: 'live' as const,
                            label: 'Live coaches',
                            hint: 'Edit Varsity, JV, and Fr/Soph together',
                          },
                        ] as const
                      ).map((row) => {
                        const on =
                          activeRole === 'admin' &&
                          adminEditMode === row.mode;
                        return (
                          <Pressable
                            key={row.mode}
                            style={[styles.modeOption, on && styles.modeOptionOn]}
                            onPress={() => pickAdminMode(row.mode)}
                          >
                            <Text
                              style={[
                                styles.modeOptionText,
                                on && styles.modeOptionTextOn,
                              ]}
                            >
                              {row.label}
                            </Text>
                            <Text
                              style={[
                                styles.modeHint,
                                on && styles.modeHintOn,
                              ]}
                            >
                              {row.hint}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  acting: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
    maxWidth: 120,
  },
  actingMuted: {
    color: colors.muted,
    fontWeight: '600',
    fontSize: 13,
  },
  btn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 160,
  },
  btnLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  btnValue: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 12,
    marginTop: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 32, 0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    gap: 8,
    maxWidth: 360,
    width: '100%',
    alignSelf: 'center',
  },
  sheetTitle: {
    fontWeight: '800',
    fontSize: 17,
    color: colors.text,
    marginBottom: 4,
  },
  sheetHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  option: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  optionOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  optionAdminOpen: {
    borderColor: colors.primary,
    backgroundColor: '#eef6ff',
  },
  optionText: {
    fontWeight: '700',
    color: colors.text,
  },
  optionTextOn: {
    color: colors.primaryText,
  },
  optionTextAdmin: {
    color: colors.primary,
  },
  modeGroup: {
    marginTop: 6,
    marginLeft: 10,
    gap: 6,
    marginBottom: 4,
  },
  modeOption: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 2,
  },
  modeOptionOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  modeOptionText: {
    fontWeight: '700',
    color: colors.text,
    fontSize: 14,
  },
  modeOptionTextOn: {
    color: colors.primaryText,
  },
  modeHint: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 16,
  },
  modeHintOn: {
    color: 'rgba(255,255,255,0.85)',
  },
});
