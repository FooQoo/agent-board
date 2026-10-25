// Gives a React tree one data core: the store, the adapter's connection and the presentation gate.
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef } from 'react';
import { DataCore, type DataCoreOptions } from '../core/data-core';

const Context = createContext<DataCore | null>(null);

export interface DataProviderProps extends DataCoreOptions {
  children: ReactNode;
  /** A core made by the caller; the provider then neither makes nor starts one. */
  core?: DataCore;
}

export function DataProvider({ children, core: given, ...options }: DataProviderProps) {
  // The callbacks may be new on every render; the core calls the latest ones.
  const latest = useRef(options);
  latest.current = options;
  const { adapter, limits, visibility } = options;
  const core = useMemo(
    () =>
      given ??
      new DataCore({
        adapter,
        limits,
        visibility,
        onReady: (build) => latest.current.onReady?.(build),
        onPreferences: (payload) => latest.current.onPreferences?.(payload),
        onConnectionState: (state) => latest.current.onConnectionState?.(state),
      }),
    [given, adapter, limits, visibility],
  );
  useEffect(() => {
    if (given) return undefined;
    core.start();
    return () => core.stop();
  }, [core, given]);
  return <Context.Provider value={core}>{children}</Context.Provider>;
}

export function useDataCore(): DataCore {
  const core = useContext(Context);
  if (!core) throw new Error('useDataCore needs a DataProvider above it');
  return core;
}
