import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@/shared/i18n';
import { dataLayerDetailEn } from '@/shared/i18n/locales/en/data-layer-detail';
import { dataLayerDetailJa } from '@/shared/i18n/locales/ja/data-layer-detail';
import { DetailError, DetailPartialNotice, DetailSkeleton } from './DetailState';

describe('DetailSkeleton', () => {
  it('shows the frame at once and a busy placeholder for the body', () => {
    const { container } = render(<DetailSkeleton frame={<h2>Task title</h2>} lines={4} />);
    expect(screen.getByRole('heading', { name: 'Task title' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Loading details…' })).toBeTruthy();
    expect(container.firstElementChild?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('.detail-state__line')).toHaveLength(4);
  });
});

describe('DetailPartialNotice', () => {
  it('says that the document is still arriving', () => {
    render(<DetailPartialNotice />);
    expect(screen.getByRole('status').textContent).toContain('Still receiving this document');
  });
});

describe('DetailError', () => {
  it('shows the reason and calls back on retry', () => {
    const onRetry = vi.fn();
    render(<DetailError message="The connection was lost." onRetry={onRetry} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Could not load the details');
    expect(alert.textContent).toContain('The connection was lost.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables the button while a retry runs', () => {
    render(<DetailError onRetry={() => {}} retrying />);
    expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('dictionary', () => {
  it('has the same keys in English and Japanese', () => {
    expect(Object.keys(dataLayerDetailJa.dataLayerDetail).sort()).toEqual(
      Object.keys(dataLayerDetailEn.dataLayerDetail).sort(),
    );
  });
});
