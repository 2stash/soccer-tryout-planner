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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!player) return;
    setFirstName(player.first_name ?? '');
    setLastName(player.last_name ?? '');
    setSchoolYear(normalizeSchoolYear(player.school_year));
    setPositions(normalizePositions(player.positions));
    setError(null);
  }, [player]);

  if (!player) return null;
  const current = player;

  async function handleSave() {
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last name are required.');
      return;
    }
    setSaving(true);
    try {
      await onSave(current.id, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        school_year: schoolYear.trim(),
        positions,
        position_rank: current.position_rank,
        team_rank: current.team_rank,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleAssign(team: PlayerAssignment | null) {
    if (!onAssignSquad) return;
    setError(null);
    setSaving(true);
    try {
      await onAssignSquad(current.id, team);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update team');
    } finally {
      setSaving(false);
    }
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

  const busy = saving || deleting;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Edit player</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
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
                value={current.squad_team}
                disabled={busy}
                onChange={(team) => void handleAssign(team)}
              />
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.primaryBtn, busy && styles.disabled]}
            disabled={busy}
            onPress={() => void handleSave()}
          >
            <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>

          {onDelete ? (
            <Pressable
              style={[styles.deleteBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void handleDelete()}
            >
              <Text style={styles.deleteText}>
                {deleting ? 'Deleting…' : 'Delete player'}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: colors.bg,
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
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  close: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 16,
  },
  body: {
    padding: layout.pagePaddingCompact,
    gap: 14,
    paddingBottom: 40,
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
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryText: {
    color: colors.primaryText,
    fontWeight: '700',
    fontSize: 16,
  },
  deleteBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  deleteText: {
    color: colors.danger,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.55,
  },
});
