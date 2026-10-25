/** How far the ngrok connection has come. The server decides it; this view only shows it. */
export type ConnectionStatus =
  | 'disabled'
  | 'needs_config'
  | 'starting'
  | 'ready'
  | 'reconnecting'
  | 'failed'
  | 'stopping';

/** The heading and text shown while a connection is starting, restoring or stopping. */
export function progressText(
  status: ConnectionStatus,
  t: (key: string) => string,
): { title: string; body: string } | null {
  switch (status) {
    case 'starting':
      return {
        title: t('monitorConnection.startingTitle'),
        body: t('monitorConnection.startingBody'),
      };
    case 'reconnecting':
      return {
        title: t('monitorConnection.reconnectingTitle'),
        body: t('monitorConnection.reconnectingBody'),
      };
    case 'stopping':
      return {
        title: t('monitorConnection.stoppingTitle'),
        body: t('monitorConnection.stoppingBody'),
      };
    default:
      return null;
  }
}
