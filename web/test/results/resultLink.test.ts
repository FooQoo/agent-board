import { describe, expect, it } from 'vitest';
import {
  parseResultTarget,
  resultLinkQuery,
  resultLinkUrl,
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
      taskId: 12,
      version: 3,
    });
    expect(parseResultTarget(resultLinkQuery(project, 7, 2) ?? '')).toEqual({
      taskId: 7,
      version: 2,
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
      '?task=12&result=99999999999',
    ])
      expect(parseResultTarget(query)).toBeNull();
  });
});
