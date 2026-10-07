import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../../src/i18n';
import { DetailPanel } from '../../src/components/DetailPanel';
import { PROJECT_A, fixtureCard, makeCard } from '../fixtures';

const CONFIRM_TEXT = 'Delete #11 "Implement card moves"? This cannot be undone.';

function renderPanel(onDeleted = vi.fn()) {
  render(
    <DetailPanel
      projectId={PROJECT_A.id}
      card={fixtureCard(11)}
      onClose={() => {}}
      onDeleted={onDeleted}
    />,
  );
  return onDeleted;
}

async function openConfirm() {
  await userEvent.click(screen.getByRole('button', { name: 'Delete card' }));
}

beforeEach(() => {
  selectLocale('en');
  document.head.innerHTML = '<meta name="skan-token" content="test-token">';
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
  selectLocale('en');
});

describe('delete confirmation', () => {
  it('interpolates Japanese confirmation and failure text without interpreting a card title as markup', async () => {
    const card = makeCard({ id: 42, title: '<img src=x onerror="alert(1)"> & "quoted"' });
    selectLocale('ja');
    const { container } = render(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={card}
        onClose={() => {}}
        onDeleted={() => {}}
        initialConfirm
        initialDeleteFailed
      />,
    );

    expect(container.querySelector('.delete-confirm__message')?.textContent).toBe(
      '#42「<img src=x onerror="alert(1)"> & "quoted"」を削除しますか？ この操作は元に戻せません。',
    );
    expect(screen.getByRole('alert').textContent).toBe(
      'カードを削除できませんでした。もう一度お試しください。',
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: '削除' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy();
    selectLocale('en');
  });

  it('opens the confirmation with Delete card', async () => {
    renderPanel();
    expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
    await openConfirm();
    expect(screen.getByText(CONFIRM_TEXT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    // The trash button stays in the toolbar under the confirmation.
    expect(screen.getByRole('button', { name: 'Delete card' })).toBeTruthy();
  });

  it('sends nothing when cancelled and puts the focus back on the trash button', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onDeleted = renderPanel();
    await openConfirm();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete card' }));
  });

  it('sends DELETE with the session token and reports success on 204', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const onDeleted = renderPanel();
    await openConfirm();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${PROJECT_A.id}/cards/11`, {
      method: 'DELETE',
      headers: { 'X-Skan-Token': 'test-token' },
    });
  });

  it('treats 404 as already deleted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 })),
    );
    const onDeleted = renderPanel();
    await openConfirm();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Could not delete the card. Try again.')).toBeNull();
  });

  it('shows a failure message on 500 and keeps the confirmation open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    const onDeleted = renderPanel();
    await openConfirm();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not delete the card. Try again.',
    );
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByText(CONFIRM_TEXT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('shows a failure message on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 403 })),
    );
    const onDeleted = renderPanel();
    await openConfirm();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Could not delete the card. Try again.')).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('shows a failure message when the request itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('network down'))),
    );
    const onDeleted = renderPanel();
    await openConfirm();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Could not delete the card. Try again.')).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('can retry after a failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const onDeleted = renderPanel();
    await openConfirm();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText('Could not delete the card. Try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('closes the confirmation when another card is shown', async () => {
    const { rerender } = render(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(11)}
        onClose={() => {}}
        onDeleted={() => {}}
      />,
    );
    await openConfirm();
    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(13)}
        onClose={() => {}}
        onDeleted={() => {}}
      />,
    );
    expect(screen.queryByText(/This cannot be undone/)).toBeNull();
  });
});
