import { StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { ImportSheet } from '@/components/ImportSheet';
import { colors } from '@/constants/theme';

export default function ImportPlayersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, loading, configured } = useAuth();

  if (!loading && (!configured || !session)) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (!id) {
    return null;
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Import spreadsheet</Text>
      <Text style={styles.sub}>
        Preview mapped columns, then confirm to insert players into this team.
      </Text>
      <ImportSheet
        rosterId={id}
        onImported={() => {
          router.replace(`/roster/${id}`);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 20,
    gap: 10,
  },
  heading: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  sub: {
    color: colors.muted,
    marginBottom: 8,
  },
});
