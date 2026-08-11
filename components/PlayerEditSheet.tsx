import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Player, PlayerAssignment, PlayerInput } from '@/lib/types';
import { normalizeSchoolYear } from '@/lib/schoolYear';
import { normalizePositions } from '@/lib/positions';
import { YearSelect } from '@/components/YearSelect';
import { PositionSelect } from '@/components/PositionSelect';
import { SquadSelect } from '@/components/SquadSelect';
import { colors, layout } from '@/constants/theme';

type Props = {
  player: Player | null;
  visible: boolean;
  onClose: () => void;
  onSave: (id: string, input: PlayerInput) => Promise<void>;
  onAssignSquad?: (
    playerId: string,
    team: PlayerAssignment | null
  ) => Promise<void>;
  onDelete?: (player: Player) => Promise<void>;
};

export function PlayerEditSheet({
  player,
  visible,
  onClose,
  onSave,
  onAssignSquad,
  onDelete,
}: Props) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [schoolYear, setSchoolYear] = useState('');
  const [positions, setPositions] = useState<number[]>([]);
  const [squadTeam, setSquadTeam] = useState<PlayerAssignment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!player) return;
    setFirstName(player.first_name ?? '');
    setLastName(player.last_name ?? '');
    setSchoolYear(normalizeSchoolYear(player.school_year));
    setPositions(normalizePositions(player.positions));
    setSquadTeam(player.squad_team);
    setError(null);
  }, [player]);

  if (!player) return null;
  const current = player;

  function handleSave() {
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last name are required.');
      return;
    }
    const input = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      school_year: schoolYear.trim(),
      positions,
    };
    const teamChanged =
      Boolean(onAssignSquad) && squadTeam !== current.squad_team;
    // Close first; persistence applies optimistically in the data layer.
    onClose();
    void (async () => {
      try {
        await onSave(current.id, input);
        if (teamChanged && onAssignSquad) {
          await onAssignSquad(current.id, squadTeam);
        }
      } catch (e) {
        console.warn(e instanceof Error ? e.message : 'Save failed');
      }
    })();
  }

  async function handleDelete() {
    if (!onDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(current);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setDeleting(false);
    }
  }

  const busy = deleting;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={busy ? undefined : onClose}
          accessibilityLabel="Dismiss"
        />
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              Edit player
            </Text>
            {onDelete ? (
              <Pressable
                onPress={() => void handleDelete()}
                hitSlop={12}
                disabled={busy}
              >
                <Text style={styles.deleteHeader}>
                  {deleting ? 'Deleting…' : 'Delete player'}
                </Text>
              </Pressable>
            ) : (
              <Pressable onPress={onClose} hitSlop={12} disabled={busy}>
                <Text style={styles.close}>Close</Text>
              </Pressable>
            )}
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            <View style={styles.field}>
              <Text style={styles.label}>First name</Text>
              <TextInput
                style={styles.input}
                value={firstName}
                onChangeText={setFirstName}
                placeholder="First"
                placeholderTextColor={colors.muted}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Last name</Text>
              <TextInput
                style={styles.input}
                value={lastName}
                onChangeText={setLastName}
                placeholder="Last"
                placeholderTextColor={colors.muted}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Year</Text>
              <YearSelect value={schoolYear} onChange={setSchoolYear} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Positions</Text>
              <PositionSelect value={positions} onChange={setPositions} />
            </View>
            {onAssignSquad ? (
              <View style={styles.field}>
                <Text style={styles.label}>Team</Text>
                <SquadSelect
                  value={squadTeam}
                  disabled={busy}
                  onChange={setSquadTeam}
                />
              </View>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.editActions}>
            <Pressable
              style={[styles.secondaryBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={onClose}
            >
              <Text style={styles.secondaryBtnText}>Close</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={handleSave}
            >
              <Text style={styles.primaryText}>Save</Text>
            </Pressable>
          </View>
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
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(21, 32, 43, 0.45)',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    backgroundColor: colors.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    shadowColor: '#15202b',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.pagePaddingCompact,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  close: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 15,
  },
  deleteHeader: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: 15,
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  body: {
    padding: layout.pagePaddingCompact,
    gap: 14,
    paddingBottom: 16,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.muted,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  error: {
    color: colors.danger,
  },
  editActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: layout.pagePaddingCompact,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: {
    color: colors.primaryText,
    fontWeight: '700',
    fontSize: 16,
  },
  secondaryBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryBtnText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 16,
  },
  disabled: {
    opacity: 0.55,
  },
});
