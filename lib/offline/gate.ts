import { Alert, Platform } from 'react-native';

/** Block non-core actions while offline (import, team admin, create roster). */
export function alertRequiresOnline(actionLabel = 'This action'): void {
  const message = `${actionLabel} needs a network connection. Try again when you're back online.`;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(message);
    return;
  }
  Alert.alert('You are offline', message);
}
