import { Alert, Platform } from 'react-native';

/**
 * Confirm a destructive / reset action. Uses `window.confirm` on web because
 * React Native `Alert.alert` button callbacks often never fire there.
 */
export function confirmAction(params: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
}): void {
  const { title, message, confirmLabel = 'OK', onConfirm } = params;

  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }

  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: confirmLabel,
      style: 'destructive',
      onPress: onConfirm,
    },
  ]);
}
