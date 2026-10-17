import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STALE_PAGE_EVENT, writeFailure } from '../../src/api';
import { StalePageNotice } from '../../src/components/notice/StalePageNotice';
import { selectLocale } from '../../src/i18n';

beforeEach(() => selectLocale('en'));
afterEach(() => vi.restoreAllMocks());

describe('StalePageNotice', () => {
  it('says the page is out of date and that typed text is lost on reload', () => {
    render(<StalePageNotice />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('This page is out of date');
    expect(alert.textContent).toContain('anything typed here is lost when you reload');
  });

  it('reloads the page from its button', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    render(<StalePageNotice />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe('writeFailure', () => {
  it('fires the stale-page event only for a page with an out-of-date token', () => {
    const onStale = vi.fn();
    window.addEventListener(STALE_PAGE_EVENT, onStale);
    const other = writeFailure('Bad file.', 422, 'file_invalid', 'task.md');
    expect(other.code).toBe('file_invalid');
    expect(onStale).not.toHaveBeenCalled();
    const stale = writeFailure('Reload.', 403, 'page_out_of_date', null);
    expect(stale.status).toBe(403);
    expect(onStale).toHaveBeenCalledTimes(1);
    window.removeEventListener(STALE_PAGE_EVENT, onStale);
  });
});
