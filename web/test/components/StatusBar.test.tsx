import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBar } from '../../src/components/StatusBar';

const synced = new Date(2026, 9, 2, 10, 42);

describe('StatusBar', () => {
  it('uses the singular for one card', () => {
    render(<StatusBar status="ready" cardCount={1} connected lastSyncedAt={synced} />);
    expect(screen.getByText('1 card')).toBeTruthy();
  });

  it('uses the plural for several cards and for none', () => {
    const { rerender } = render(<StatusBar status="ready" cardCount={8} connected lastSyncedAt={synced} />);
    expect(screen.getByText('8 cards')).toBeTruthy();
    rerender(<StatusBar status="ready" cardCount={0} connected lastSyncedAt={synced} />);
    expect(screen.getByText('0 cards')).toBeTruthy();
  });

  it('shows the last sync time while connected', () => {
    render(<StatusBar status="ready" cardCount={8} connected lastSyncedAt={synced} />);
    expect(screen.getByText('Synced 10:42')).toBeTruthy();
  });

  it('shows the disconnected state with the last sync time', () => {
    render(<StatusBar status="ready" cardCount={8} connected={false} lastSyncedAt={synced} />);
    expect(screen.getByText('Disconnected · Last synced 10:42')).toBeTruthy();
    expect(screen.queryByText(/^Synced/)).toBeNull();
  });

  it('shows Connecting… and a dash while the first load is running', () => {
    render(<StatusBar status="loading" cardCount={0} connected={false} lastSyncedAt={null} />);
    expect(screen.getByText('Connecting…')).toBeTruthy();
    expect(screen.getByText('–')).toBeTruthy();
  });

  it('shows Not connected and a dash when the board could not be loaded', () => {
    render(<StatusBar status="error" cardCount={0} connected={false} lastSyncedAt={null} />);
    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(screen.getByText('–')).toBeTruthy();
  });
});
