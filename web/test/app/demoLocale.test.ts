// @vitest-environment node
// The browser demo starts in the browser's language: the screens, the guide and the sample data.
import { describe, expect, it } from 'vitest';
import longMarkdown from '../fixtures/long-markdown.md?raw';
import fixture from '../fixtures/board.json';
import type { Board, Task } from '../../src/shared/api/contracts';
import { browserLanguages, demoLocale } from '../../src/app/development/demo/locale';
import { sampleBoards } from '../../src/app/development/mock-server/boards';
import { createMockServer, SAMPLE_PROJECTS } from '../../src/app/development/mock-server/server';

const seed = { fixture: fixture as unknown as Board, longMarkdown };
const JAPANESE = /[぀-ヿ㐀-鿿]/;
const PROJECT = SAMPLE_PROJECTS[0]?.id ?? '';
const firstBoard = (locale: 'en' | 'ja'): Task[] =>
  sampleBoards({ ...seed, locale })[PROJECT]?.tasks ?? [];

describe('demoLocale', () => {
  it('starts in Japanese when the most preferred language is Japanese', () => {
    expect(demoLocale(['ja'])).toBe('ja');
    expect(demoLocale(['ja-JP', 'en-US'])).toBe('ja');
    expect(demoLocale(['JA-jp'])).toBe('ja');
  });

  it('starts in English otherwise, even when Japanese comes later', () => {
    expect(demoLocale(['en-US', 'ja-JP'])).toBe('en');
    expect(demoLocale(['fr-FR'])).toBe('en');
    expect(demoLocale([])).toBe('en');
  });

  it('reads navigator.languages, or navigator.language when the list is empty', () => {
    expect(browserLanguages({ languages: ['ja-JP', 'en'], language: 'ja-JP' })).toEqual([
      'ja-JP',
      'en',
    ]);
    expect(browserLanguages({ languages: [], language: 'ja' })).toEqual(['ja']);
    expect(browserLanguages({ languages: [], language: '' })).toEqual([]);
  });
});

describe('Japanese sample data', () => {
  it('keeps the shape of the English board and changes only the words', () => {
    const shape = (tasks: Task[]) =>
      tasks.map((task) => ({
        id: task.id,
        lane: task.taskStatus,
        agent: task.agentStatus,
        assignee: task.assignee,
        epic: task.epic?.id ?? null,
        choices: task.pendingChoices.map((choice) => choice.id),
        conditions: task.acceptance.map((condition) => [condition.id, condition.done]),
        history: task.history.length,
      }));
    expect(shape(firstBoard('ja'))).toEqual(shape(firstBoard('en')));
  });

  it('writes every title, reason, choice, condition and history entry in Japanese', () => {
    for (const task of firstBoard('ja')) {
      const texts = [
        task.title,
        task.description,
        task.pendingReason ?? '',
        task.epic?.name ?? '',
        ...task.pendingChoices.map((choice) => choice.label),
        ...task.acceptance.map((condition) => condition.text),
        ...task.history.map((entry) => entry.reason),
      ].filter((text) => text !== '');
      for (const text of texts) expect(text, `#${task.id}`).toMatch(JAPANESE);
    }
  });

  it('stays in English by default, as the sample-data mode shows it', () => {
    expect(firstBoard('en').find((task) => task.id === 11)?.title).toBe('Implement task moves');
    expect(sampleBoards(seed)[PROJECT]?.tasks.find((task) => task.id === 11)?.title).toBe(
      'Implement task moves',
    );
  });

  it('writes the history of a new card in the language of the page', () => {
    const server = createMockServer({ ...seed, locale: 'ja' });
    const result = server.handle({
      method: 'POST',
      url: `/api/projects/${PROJECT}/tasks`,
      headers: { 'x-agboard-token': 'demo-token', 'x-agboard-language': 'ja' },
      body: JSON.stringify({ title: '新しいカード', assignee: 'ai' }),
    });
    expect(result?.kind === 'response' && result.status).toBe(201);
    const created = server.boards()[PROJECT]?.tasks.find((task) => task.title === '新しいカード');
    expect(created?.history.map((entry) => entry.reason)).toEqual(['タスクをTodoに作成しました。']);
  });
});
