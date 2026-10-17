import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DetailPanel } from '../../src/components/DetailPanel';
import { selectLocale } from '../../src/i18n';
import type { Problem } from '../../src/types';
import { PROJECT_A, makeTask } from '../fixtures';

const noop = () => {};
const noRemove = async () => true;
const task = makeTask({ id: 12, title: 'Task', description: '## 作業内容\n\n本文の内容\n' });
// The board reports a problem by its path from the shared folder, as the CLI and the API do.
const file = `projects/${PROJECT_A.id}/tasks/12/TASK.md`;

beforeEach(() => selectLocale('en'));

function panel(problems: Problem[]) {
  return render(
    <DetailPanel
      projectId={PROJECT_A.id}
      task={task}
      problems={problems}
      onClose={noop}
      onRemove={noRemove}
    />,
  );
}

describe('file problems in the detail', () => {
  it('shows the file, item and reason above the body and keeps the body as written', () => {
    const { container } = panel([
      {
        file,
        field: 'AC-1',
        reason: 'A line starting with "- 根拠:" is missing.',
      },
    ]);
    const warning = screen.getByRole('alert');
    expect(warning.textContent).toBe(
      `This file has a problem: ${file} (AC-1) — A line starting with "- 根拠:" is missing.`,
    );
    const body = screen.getByText('本文の内容');
    expect(warning.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('.md-chapter')).not.toBeNull();
  });

  it('shows the Japanese wording', () => {
    selectLocale('ja');
    panel([{ file, field: 'AC-1', reason: '理由' }]);
    expect(screen.getByRole('alert').textContent).toBe(
      `ファイルに不備があります: ${file}（AC-1） — 理由`,
    );
  });

  it('shows only the problems of this task and none without a problem', () => {
    const { unmount } = panel([
      { file: `projects/${PROJECT_A.id}/tasks/99/TASK.md`, field: 'AC-1', reason: 'other' },
    ]);
    expect(screen.queryByRole('alert')).toBeNull();
    unmount();
    panel([]);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
