export interface BoardMessageProps {
  kind: 'empty' | 'loading' | 'error';
  onRetry?: () => void;
}

export function BoardMessage({ kind, onRetry }: BoardMessageProps) {
  if (kind === 'loading') {
    return (
      <div className="board-message board-message--loading" role="status">
        <p className="board-message__title">Loading…</p>
      </div>
    );
  }
  if (kind === 'error') {
    return (
      <div className="board-message board-message--error" role="alert">
        <p className="board-message__title">Could not load the board.</p>
        <button type="button" className="button button--primary" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  return (
    <div className="board-message board-message--empty" role="status">
      <p className="board-message__title">No cards yet.</p>
      <p className="board-message__sub">Agents add cards with "skan add &lt;title&gt;".</p>
    </div>
  );
}
