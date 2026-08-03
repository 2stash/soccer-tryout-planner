import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { PlayerInput } from '@/lib/types';
import { PLAYER_FIELD_LABELS } from '@/lib/types';
import { normalizeSchoolYear } from '@/lib/schoolYear';
import { normalizePositions } from '@/lib/positions';
import { YearSelect } from '@/components/YearSelect';
import { PositionSelect } from '@/components/PositionSelect';
import { colors } from '@/constants/theme';

type Props = {
  initial?: Partial<PlayerInput>;
  submitLabel?: string;
  onSubmit: (value: PlayerInput) => Promise<void> | void;
  onCancel?: () => void;
};

function parseRank(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export function PlayerForm({
  initial,
  submitLabel = 'Save',
  onSubmit,
  onCancel,
}: Props) {
  const [firstName, setFirstName] = useState(initial?.first_name ?? '');
  const [lastName, setLastName] = useState(initial?.last_name ?? '');
  const [schoolYear, setSchoolYear] = useState(
    normalizeSchoolYear(initial?.school_year ?? '')
  );
  const [positions, setPositions] = useState<number[]>(
    normalizePositions(initial?.positions ?? [])
  );
  const [positionRank, setPositionRank] = useState(
    initial?.position_rank != null ? String(initial.position_rank) : ''
  );
  const [teamRank, setTeamRank] = useState(
    initial?.team_rank != null ? String(initial.team_rank) : ''
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError('First name and last name are required.');
      return;
    }

    if (positionRank.trim() && parseRank(positionRank) === null) {
      setError('Position rank must be a number.');
      return;
    }
    if (teamRank.trim() && parseRank(teamRank) === null) {
      setError('Team rank must be a number.');
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        school_year: schoolYear.trim(),
        positions,
        position_rank: parseRank(positionRank),
        team_rank: parseRank(teamRank),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save player');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.form}>
      <Field label={PLAYER_FIELD_LABELS.first_name} value={firstName} onChangeText={setFirstName} />
      <Field label={PLAYER_FIELD_LABELS.last_name} value={lastName} onChangeText={setLastName} />
      <View style={styles.field}>
        <Text style={styles.label}>{PLAYER_FIELD_LABELS.school_year}</Text>
        <YearSelect value={schoolYear} onChange={setSchoolYear} />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>{PLAYER_FIELD_LABELS.positions}</Text>
        <PositionSelect value={positions} onChange={setPositions} />
      </View>
      <Field
        label={PLAYER_FIELD_LABELS.position_rank}
        value={positionRank}
        onChangeText={setPositionRank}
        keyboardType="numeric"
      />
      <Field
        label={PLAYER_FIELD_LABELS.team_rank}
        value={teamRank}
        onChangeText={setTeamRank}
        keyboardType="numeric"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        {onCancel ? (
          <Pressable style={styles.secondaryBtn} onPress={onCancel}>
            <Text style={styles.secondaryText}>Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.primaryBtn, saving && styles.disabled]}
          onPress={handleSubmit}
          disabled={saving}
        >
          <Text style={styles.primaryText}>{saving ? 'Saving…' : submitLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        autoCapitalize="words"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: 12,
    maxWidth: 520,
    width: '100%',
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    justifyContent: 'flex-end',
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  primaryText: {
    color: colors.primaryText,
    fontWeight: '600',
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  secondaryText: {
    color: colors.text,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.6,
  },
});
