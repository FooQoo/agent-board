import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ConnectionRequestError,
  deleteSavedToken,
  getConnection,
  saveSettings,
  startConnection,
  stopConnection,
  type ConnectionSnapshot,
} from './api';
import type { ConnectionDraft, ConnectionQr, TokenInfo } from './ui/ConnectionSettingsView';
import type { ConnectionStatus } from './ui/connectionProgress';
import { qrDataUrl } from './qr';

const POLL_MS = 1500;

/**
 * The state behind the connection dialog: it reads the status from the local API, saves the
 * settings, starts and stops. The token goes straight to the start request and is kept nowhere.
 */
export function useConnectionController(open: boolean) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await getConnection();
      if (savingRef.current) return;
      setSnapshot(next);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  const status: ConnectionStatus | null = snapshot?.status ?? null;
  const transient = status === 'starting' || status === 'reconnecting' || status === 'stopping';
  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);
  useEffect(() => {
    if (!open && !transient) return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, transient, refresh]);

  const messageOf = useCallback(
    (cause: unknown): string => {
      if (cause instanceof ConnectionRequestError) {
        switch (cause.code) {
          case 'revision_conflict':
            return t('monitorConnectionPc.error.conflict');
          case 'save_failed':
            return t('monitorConnectionPc.error.saveFailed');
          case 'token_required':
            return t('monitorConnectionPc.error.tokenRequired');
          case 'invalid_value':
            return t('monitorConnectionPc.error.invalid');
          case 'settings_unreadable':
            return t('monitorConnectionPc.error.unreadable');
          case 'keychain_unavailable':
            return t('monitorConnectionPc.error.keychainUnavailable');
          case 'start_failed':
            return t('monitorConnectionPc.error.startFailed');
          default:
            return t('monitorConnectionPc.error.unreachable');
        }
      }
      return t('monitorConnectionPc.error.unreachable');
    },
    [t],
  );

  const connect = useCallback(
    async (draft: ConnectionDraft) => {
      if (savingRef.current) return;
      if (!snapshot) {
        setError(t('monitorConnectionPc.error.unreachable'));
        return;
      }
      const token = draft.token.trim();
      // An environment or keychain token is enough; the server answers token_required otherwise.
      if (!token && !snapshot.tokenConfigured) {
        setError(t('monitorConnectionPc.error.tokenRequired'));
        return;
      }
      savingRef.current = true;
      setSaving(true);
      setError(null);
      try {
        let next = await saveSettings({
          enabled: true,
          domain: draft.domain.trim() || null,
          revision: snapshot.revision,
        });
        setSnapshot(next);
        const running =
          next.status === 'starting' || next.status === 'ready' || next.status === 'reconnecting';
        // A new token always restarts; otherwise a saved change has already restarted a live tunnel.
        if (token || !running)
          next = await startConnection(
            token || null,
            Boolean(token) && draft.save && snapshot.keychainAvailable,
          );
        setSnapshot(next);
        setEditing(false);
      } catch (cause) {
        setError(messageOf(cause));
        // The server may hold newer settings after a conflict; show what is really saved.
        savingRef.current = false;
        await refresh();
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [snapshot, t, messageOf, refresh],
  );

  const stop = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      setSnapshot(await stopConnection());
      setEditing(false);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [messageOf]);

  const removeToken = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      setSnapshot(await deleteSavedToken());
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [messageOf]);

  const savedDomain = snapshot?.settings.domain ?? '';
  const draft = useMemo<ConnectionDraft>(
    () => ({ token: '', domain: savedDomain, save: false }),
    [savedDomain],
  );
  const tokenInfo = useMemo<TokenInfo>(
    () => ({
      source: snapshot?.tokenSource ?? null,
      keychainAvailable: snapshot?.keychainAvailable ?? true,
      saved: snapshot?.keychainTokenSaved ?? false,
    }),
    [snapshot],
  );
  const url = snapshot?.status === 'ready' ? snapshot.url : null;
  // The server sends the passcode only while the connection is ready; show nothing otherwise.
  const passcode = snapshot?.status === 'ready' ? (snapshot.passcode ?? null) : null;
  const qr: ConnectionQr | null = useMemo(() => (url ? { src: qrDataUrl(url) } : null), [url]);

  // The failure reason is a fixed code, never a message from the network.
  const failure =
    snapshot?.status === 'failed' && snapshot.failure
      ? t(`monitorConnectionPc.failure.${snapshot.failure}`)
      : null;

  // Editing a live connection shows the form again; the saved status returns after Save.
  const shown: ConnectionStatus =
    status === 'ready' && editing ? 'needs_config' : (status ?? 'disabled');

  return {
    ready: snapshot !== null,
    loadFailed,
    status: shown,
    draft,
    tokenInfo,
    removeToken,
    url,
    passcode,
    qr,
    error: error ?? failure ?? (loadFailed ? t('monitorConnectionPc.error.unreachable') : null),
    saving,
    connect,
    stop,
    edit: () => setEditing(true),
    cancelEdit: () => setEditing(false),
  };
}
