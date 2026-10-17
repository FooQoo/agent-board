import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../../src/i18n';
import { DetailPanel } from '../../src/components/DetailPanel';
import { PROJECT_A, fixtureTask, makeTask } from '../fixtures';

const CONFIRM_TEXT = 'Archive #11 "Implement task moves"? You can restore it from the archive.';

function renderPanel(onRemove = vi.fn(async () => true)) {
  render(
    <DetailPanel
      projectId={PROJECT_A.id}
      task={fixtureTask(11)}
      onClose={() => {}}
      onRemove={onRemove}
    />,
  );
  return onRemove;
}

async function openConfirm() {
  await userEvent.click(screen.getByRole('button', { name: 'Archive task' }));
}

beforeEach(() => {
  selectLocale('en');
  document.head.innerHTML = '<meta name="agboard-token" content="test-token">';
});

describe('inline archive confirmation', () => {
  it('renders localized confirmation text and failure without interpreting a title as markup', () => {
    const task = makeTask({ id: 42, title: '<img src=x onerror="alert(1)"> & "quoted"' });
    selectLocale('ja');
    const { container } = render(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={task}
        onClose={() => {}}
        onRemove={async () => false}
        initialConfirm
        initialDeleteFailed
      />,
    );

    expect(container.querySelector('.delete-confirm__message')?.textContent).toBe(
      '#42「<img src=x onerror="alert(1)"> & "quoted"」をアーカイブしますか？ アーカイブ一覧から復元できます。',
    );
    expect(screen.getByRole('alert').textContent).toBe(
      'タスクをアーカイブできませんでした。もう一度お試しください。',
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'アーカイブ' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy();
    selectLocale('en');
  });

  it('leaves request execution to the lifecycle callback and returns focus on cancel', async () => {
    const onRemove = renderPanel();
    await openConfirm();
    expect(screen.getByText(CONFIRM_TEXT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Archive task' }));
  });

  it('keeps the inline confirmation open after a lifecycle failure and allows retry', async () => {
    const onRemove = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderPanel(onRemove);
    await openConfirm();
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('Could not archive the task. Try again.')).toBeTruthy();
    expect(screen.getByText(CONFIRM_TEXT)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onRemove).toHaveBeenCalledTimes(2);
    expect(onRemove).toHaveBeenLastCalledWith('archive', fixtureTask(11));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the confirm and cancel buttons disabled while the lifecycle operation is saving', async () => {
    const onRemove = vi.fn(async () => false);
    render(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={fixtureTask(11)}
        onClose={() => {}}
        onRemove={onRemove}
        initialConfirm
        operationSaving
      />,
    );
    expect(screen.getByRole('button', { name: 'Archive' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
  });
});
