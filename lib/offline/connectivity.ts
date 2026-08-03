import { useEffect, useState } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

function onlineFromState(state: NetInfoState): boolean {
  // Only treat explicit disconnect as offline. isInternetReachable flickers on
  // iOS when backgrounding/resuming and causes false offline + UI thrash.
  if (state.isConnected === false) return false;
  return true;
}

/** Subscribe to connectivity; defaults to online until first NetInfo event. */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let mounted = true;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const apply = (state: NetInfoState) => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (mounted) setOnline(onlineFromState(state));
      }, 250);
    };

    void NetInfo.fetch().then((state) => {
      if (mounted) setOnline(onlineFromState(state));
    });
    const unsub = NetInfo.addEventListener(apply);
    return () => {
      mounted = false;
      if (debounce) clearTimeout(debounce);
      unsub();
    };
  }, []);

  return online;
}
