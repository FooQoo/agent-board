import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MarkdownSections } from '../../src/components/markdown/MarkdownSections';
import { selectLocale } from '../../src/i18n';

beforeEach(() => selectLocale('en'));
afterEach(cleanup);

const SOURCE = 'Intro text\n\n## Goals\n\nGoal body\n\n## Steps\n\n1. one\n2. two\n3. three\n';

describe('MarkdownSections as chapters', () => {
  it('shows the preamble, then each H2 as a plain heading with no number chip', () => {
    const { container } = render(<MarkdownSections source={SOURCE} />);
    expect(screen.getByText('Intro text')).toBeTruthy();
    expect(container.querySelector('.md-chapter__number')).toBeNull();
    expect(container.querySelectorAll('.md-chapter')).toHaveLength(2);
    expect(screen.getByRole('heading', { level: 3, name: 'Goals' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Steps' })).toBeTruthy();
  });

  it('never folds a section: every body stays visible and no toggle or count is shown', () => {
    const { container } = render(<MarkdownSections source={SOURCE} />);
    expect(screen.getByText('Goal body')).toBeTruthy();
    expect(screen.getByText('three')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[aria-expanded]')).toBeNull();
    expect(container.querySelector('.md-section__count')).toBeNull();
  });

  it('keeps the chapters when the description changes under the same task', () => {
    const { container, rerender } = render(<MarkdownSections key="card-1" source={SOURCE} />);
    rerender(<MarkdownSections key="card-1" source={`${SOURCE}\nmore`} />);
    expect(container.querySelector('.md-chapter__number')).toBeNull();
    expect(container.querySelectorAll('.md-chapter')).toHaveLength(2);
    expect(screen.getByText('Goal body')).toBeTruthy();
  });

  it('shows the whole text without chapters when there is no H2', () => {
    const { container } = render(
      <MarkdownSections source={'# Title\n\nJust text\n\n### Sub\n\n- a\n'} />,
    );
    expect(screen.getByText('Just text')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Sub' })).toBeTruthy();
    expect(container.querySelector('.md-chapter')).toBeNull();
  });

  it('shows the H3 inside a chapter without folding it', () => {
    render(<MarkdownSections source={'## A\n\n### A1\n\ntext\n'} />);
    expect(screen.getByRole('heading', { level: 3, name: 'A1' })).toBeTruthy();
    expect(screen.getByText('text')).toBeTruthy();
  });

  it('does not split a code block or a quote at its ## lines', () => {
    const { container } = render(<MarkdownSections source={'## Real\n\n```\n## Fake\n```\n'} />);
    expect(container.querySelectorAll('.md-chapter')).toHaveLength(1);
    expect(screen.getByText('## Fake', { exact: false })).toBeTruthy();
  });

  it('shows the empty message for a blank description', () => {
    render(<MarkdownSections source={'  \n'} />);
    expect(screen.getByText('No description.')).toBeTruthy();
    selectLocale('ja');
    cleanup();
    render(<MarkdownSections source="" />);
    expect(screen.getByText('説明はありません。')).toBeTruthy();
  });
});

const CONDITIONS = [
  '## 完了条件と確認結果',
  '',
  '- [x] AC-1. 本文と画像を確認できる',
  '  - 確認結果: 一覧と詳細で確認。',
  '  - 根拠: #24の記録。',
  '  - 調整役の確認: 未確認',
  '',
  '  ![first](https://example.com/one.png)',
  '  ![second](https://example.com/two.png)',
  '',
  '- [ ] AC-2. 再開時に読める',
  '  - 確認結果: 未確認',
  '  - 根拠: 未記入',
  '  - 調整役の確認: 未確認',
].join('\n');

describe('completion conditions in the reading view', () => {
  it('shows each checkbox state as a display only and does not change it when pressed', () => {
    const { container } = render(<MarkdownSections source={CONDITIONS} />);
    const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
    expect(boxes.every((box) => box.disabled)).toBe(true);
    fireEvent.click(boxes[1] as HTMLInputElement);
    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
  });

  it('keeps the detail lines under their condition', () => {
    render(<MarkdownSections source={CONDITIONS} />);
    expect(screen.getByText('確認結果: 一覧と詳細で確認。', { exact: false })).toBeTruthy();
    expect(screen.getByText('根拠: #24の記録。', { exact: false })).toBeTruthy();
  });

  it('shows two consecutive captures under a condition as one row of small pictures', () => {
    const { container } = render(<MarkdownSections source={CONDITIONS} />);
    const row = container.querySelector('.md-captures');
    expect(row).not.toBeNull();
    expect(row?.querySelectorAll('img')).toHaveLength(2);
  });
});
