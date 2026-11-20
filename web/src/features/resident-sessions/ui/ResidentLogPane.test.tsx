import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../shared/i18n';
import type { SessionLog } from '../api';
import { ResidentLogPane } from './ResidentLogPane';

afterEach(cleanup);

const read = (over: Partial<SessionLog>): SessionLog => ({
  tool: 'codex',
  exists: true,
  text: 'line one\nline two\n',
  truncated: false,
  size: 18,
  ...over,
});

describe('ResidentLogPane', () => {
  it('shows the empty state when no session has been launched', () => {
    render(
      <ResidentLogPane
        tool="codex"
        log={{ data: read({ exists: false, text: '', size: 0 }), failed: false }}
      />,
    );
    expect(screen.getByText('The log appears once the agent has started.')).toBeTruthy();
  });

  it('notes a truncated tail and keeps the text selectable', () => {
    render(
      <ResidentLogPane tool="codex" log={{ data: read({ truncated: true }), failed: false }} />,
    );
    expect(screen.getByText('Only the end of the log is shown.')).toBeTruthy();
    expect(screen.getByText(/line two/).tagName).toBe('PRE');
  });

  it('says a failed read quietly and keeps the last tail', () => {
    render(<ResidentLogPane tool="codex" log={{ data: read({}), failed: true }} />);
    expect(screen.getByText('Could not read the log. Trying again.')).toBeTruthy();
    expect(screen.getByText(/line one/)).toBeTruthy();
  });

  describe('following the end', () => {
    let top = 0;
    const metrics = { scrollHeight: 1000, clientHeight: 200 };
    beforeEach(() => {
      top = 0;
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
        () => metrics.scrollHeight,
      );
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
        () => metrics.clientHeight,
      );
      vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(() => top);
      vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation((value) => {
        top = value;
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it('scrolls to the end on new text, but not after the reader scrolled up', () => {
      const { rerender, container } = render(
        <ResidentLogPane tool="codex" log={{ data: read({}), failed: false }} />,
      );
      expect(top).toBe(1000);
      metrics.scrollHeight = 1200;
      rerender(
        <ResidentLogPane tool="codex" log={{ data: read({ text: 'a\nb\nc\n' }), failed: false }} />,
      );
      expect(top).toBe(1200);

      // The reader scrolls up to read: the next text leaves the position alone.
      top = 300;
      act(() => {
        container
          .querySelector('.resident-log__scroll')
          ?.dispatchEvent(new Event('scroll', { bubbles: true }));
      });
      metrics.scrollHeight = 1400;
      rerender(
        <ResidentLogPane
          tool="codex"
          log={{ data: read({ text: 'a\nb\nc\nd\n' }), failed: false }}
        />,
      );
      expect(top).toBe(300);
    });
  });
});
