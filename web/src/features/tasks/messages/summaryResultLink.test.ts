import { describe, expect, it } from 'vitest';
import { parseResultTarget } from '../results/resultLink';
import { isPlainPrimaryClick, openInPage, summaryResultHref } from './summaryResultLink';

const PROJECT = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';

describe('summaryResultHref', () => {
  it('opens the linked version of the task results, like a notification link', () => {
    const href = summaryResultHref(PROJECT, { taskId: 552, version: 2, title: 'x' });
    expect(href).toBe(`?project=${PROJECT}&task=552&result=2`);
    expect(parseResultTarget(href ?? '')).toEqual({
      projectId: PROJECT,
      taskId: 552,
      version: 2,
      tab: 'results',
    });
  });

  it('opens the results tab with no version for a line written before versions', () => {
    const href = summaryResultHref(PROJECT, { taskId: 552, version: null, title: 'x' });
    expect(href).toBe(`?project=${PROJECT}&task=552&tab=results`);
    expect(parseResultTarget(href ?? '')).toEqual({
      projectId: PROJECT,
      taskId: 552,
      version: null,
      tab: 'results',
    });
  });

  it('gives no link for a project or task that cannot be a target', () => {
    expect(summaryResultHref('nope', { taskId: 1, version: 1, title: 'x' })).toBeNull();
    expect(summaryResultHref(PROJECT, { taskId: 0, version: null, title: 'x' })).toBeNull();
  });

  it('does not treat a damaged result as the whole results tab', () => {
    expect(parseResultTarget(`project=${PROJECT}&task=1&result=abc&tab=results`)).toBeNull();
  });
});

describe('isPlainPrimaryClick', () => {
  const click = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  };

  it('takes over an unmodified primary click', () => {
    expect(isPlainPrimaryClick(click)).toBe(true);
  });

  it.each([
    ['meta', { metaKey: true }],
    ['control', { ctrlKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['middle button', { button: 1 }],
    ['secondary button', { button: 2 }],
    ['handled click', { defaultPrevented: true }],
  ])('leaves a %s click to the browser', (_name, change) => {
    expect(isPlainPrimaryClick({ ...click, ...change })).toBe(false);
  });
});

describe('openInPage', () => {
  it('changes the address through the history without loading the page', () => {
    openInPage(summaryResultHref(PROJECT, { taskId: 7, version: 3, title: 'x' }) ?? '');
    expect(window.location.search).toBe(`?project=${PROJECT}&task=7&result=3`);
  });
});
