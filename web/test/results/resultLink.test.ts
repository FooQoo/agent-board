import { describe, expect, it } from 'vitest';
import {
  parseResultTarget,
  historyLinkQuery,
  isQuestionId,
  linkKey,
  questionLinkQuery,
  resultLinkQuery,
  resultLinkUrl,
  type ResultLinkTarget,
} from '../../src/features/tasks/results/resultLink';

const project = '0123456789abcdef0123456789abcdef';

describe('result link', () => {
  it('builds the query and the address from a project, a task, and a version', () => {
    expect(resultLinkQuery(project, 12, 3)).toBe(`?project=${project}&task=12&result=3`);
    expect(resultLinkUrl('https://abc.ngrok-free.app', project, 12, 3)).toBe(
      `https://abc.ngrok-free.app/?project=${project}&task=12&result=3`,
    );
  });

  it('drops the path and the hash of the origin', () => {
    expect(resultLinkUrl('https://abc.ngrok-free.app/x?y=1#z', project, 1, 1)).toBe(
      `https://abc.ngrok-free.app/?project=${project}&task=1&result=1`,
    );
  });

  it('gives nothing for a bad project, task, version, or origin', () => {
    expect(resultLinkQuery('nope', 1, 1)).toBeNull();
    expect(resultLinkQuery(project, 0, 1)).toBeNull();
    expect(resultLinkQuery(project, 1, 1.5)).toBeNull();
    expect(resultLinkUrl(null, project, 1, 1)).toBeNull();
    expect(resultLinkUrl('not a url', project, 1, 1)).toBeNull();
    expect(resultLinkUrl('javascript:alert(1)', project, 1, 1)).toBeNull();
  });

  it('reads the target of a page query and round-trips a built one', () => {
    expect(parseResultTarget(`?project=${project}&task=12&result=3`)).toEqual({
      projectId: project,
      taskId: 12,
      version: 3,
      tab: 'results',
    });
    expect(parseResultTarget(resultLinkQuery(project, 7, 2) ?? '')).toEqual({
      projectId: project,
      taskId: 7,
      version: 2,
      tab: 'results',
    });
  });

  it('takes a damaged link for no target', () => {
    for (const query of [
      '',
      '?task=12',
      '?result=3',
      '?task=0&result=3',
      '?task=a&result=3',
      '?task=1.5&result=3',
      '?task=-1&result=3',
      '?task=12&result=4294967296',
      '?task=9007199254740993&result=3',
    ])
      expect(parseResultTarget(query.replace('?', `?project=${project}&`))).toBeNull();
  });

  it('takes a link without a valid project for no target', () => {
    expect(parseResultTarget('?task=12&result=3')).toBeNull();
    expect(parseResultTarget('?project=nope&task=12&result=3')).toBeNull();
  });

  it('parses every task and version the builders emit', () => {
    const link = resultLinkQuery(project, 10_000_000_000, 4_294_967_295) ?? '';
    expect(parseResultTarget(link)).toEqual({
      projectId: project,
      taskId: 10_000_000_000,
      version: 4_294_967_295,
      tab: 'results',
    });
    expect(resultLinkQuery(project, 1, 4_294_967_296)).toBeNull();
  });

  it('builds and reads a history link, and ignores a damaged one', () => {
    expect(historyLinkQuery(project, 12)).toBe(`?project=${project}&task=12&tab=history`);
    expect(historyLinkQuery('nope', 12)).toBeNull();
    expect(historyLinkQuery(project, 0)).toBeNull();
    expect(parseResultTarget(`?project=${project}&task=12&tab=history`)).toEqual({
      projectId: project,
      taskId: 12,
      version: null,
      tab: 'history',
    });
    // A result link wins over the tab, and a damaged result is no target even with the tab.
    expect(parseResultTarget(`?project=${project}&task=12&result=2&tab=history`)).toMatchObject({
      version: 2,
      tab: 'results',
    });
    expect(parseResultTarget(`?project=${project}&task=12&result=x&tab=history`)).toBeNull();
    expect(parseResultTarget(`?project=${project}&task=12&tab=other`)).toBeNull();
    expect(parseResultTarget(`?project=${project}&task=0&tab=history`)).toBeNull();
  });

  it('builds and reads a question link, and ignores a damaged one', () => {
    expect(questionLinkQuery(project, 12, 'Q-7')).toBe(`?project=${project}&task=12&question=Q-7`);
    for (const bad of ['', 'Q-', 'Q-0', 'Q-07', 'q-7', 'Q-7&x=1', '7', 'Q-12345678901234567'])
      expect(questionLinkQuery(project, 12, bad)).toBeNull();
    expect(isQuestionId('Q-12')).toBe(true);
    const target = parseResultTarget(`?project=${project}&task=12&question=Q-7`);
    expect(target).toEqual({
      projectId: project,
      taskId: 12,
      version: null,
      questionId: 'Q-7',
      tab: 'question',
    });
    expect(linkKey(target as ResultLinkTarget)).toBe('12:Q-7');
    expect(parseResultTarget(`?project=${project}&task=12&question=nope`)).toBeNull();
    expect(parseResultTarget(`?project=${project}&question=Q-7`)).toBeNull();
    expect(parseResultTarget(`?project=${project}&task=12&result=2&question=Q-7`)).toMatchObject({
      tab: 'results',
    });
  });
});
