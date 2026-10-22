import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { applyPreferenceEvent, syncPreferences } from '../../shared/preferences';
import type { ConnectionState } from '../../shared/data/core';
import { DataProvider } from '../../shared/data/react';
import { createPcAdapter, type PcAdapter } from './pcAdapter';

export interface PcConnection {
  adapter: PcAdapter;
  /** The build ID the latest `ready` event named; `null` until one arrives. */
  serverBuild: string | null;
  /** The stream broke and has not been reopened. A hidden tab is not down. */
  streamDown: boolean;
}

const Context = createContext<PcConnection | null>(null);

export function usePcConnection(): PcConnection {
  const value = useContext(Context);
  if (!value) throw new Error('usePcConnection needs a PcDataProvider above it');
  return value;
}

/** Gives the board one data core over its own server, and the facts the app reads from the stream. */
export function PcDataProvider({
  children,
  adapter: given,
}: {
  children: ReactNode;
  /** An adapter made by the caller (tests). */
  adapter?: PcAdapter;
}) {
  const adapter = useMemo(() => given ?? createPcAdapter(), [given]);
  const [serverBuild, setServerBuild] = useState<string | null>(null);
  const [streamDown, setStreamDown] = useState(false);

  const onReady = useCallback((build: string) => {
    setServerBuild(build === '' ? null : build);
    // A save made while the stream was down is read again.
    if (import.meta.env.MODE !== 'mock') void syncPreferences({ url: '/api/preferences' });
  }, []);
  // The saved language and theme are shown at once; the board is not read again for them.
  const onPreferences = useCallback((event: unknown) => applyPreferenceEvent(event as Event), []);
  const onConnectionState = useCallback(
    (state: ConnectionState) => setStreamDown(state === 'disconnected'),
    [],
  );

  const value = useMemo(
    () => ({ adapter, serverBuild, streamDown }),
    [adapter, serverBuild, streamDown],
  );
  return (
    <DataProvider
      adapter={adapter}
      onReady={onReady}
      onPreferences={onPreferences}
      onConnectionState={onConnectionState}
    >
      <Context.Provider value={value}>{children}</Context.Provider>
    </DataProvider>
  );
}
