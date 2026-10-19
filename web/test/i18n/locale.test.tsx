import { act, render, screen } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initializeLocale,
  i18n,
  LOCALE_STORAGE_KEY,
  readLocale,
  selectLocale,
  type LocaleStorageProvider,
} from '../../src/shared/i18n';

function memoryStorage(value: string | null) {
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn(),
  };
}

function CountProbe() {
  const { t } = useTranslation();
  return <p>{t('status.cardCount', { count: 2 })}</p>;
}

const originalLanguageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'language');

afterEach(() => {
  initializeLocale(() => memoryStorage(null));
  if (originalLanguageDescriptor) {
    Object.defineProperty(navigator, 'language', originalLanguageDescriptor);
  } else {
    Reflect.deleteProperty(navigator, 'language');
  }
});

describe('locale selection', () => {
  it('starts in English with no saved value even when the browser language is Japanese', () => {
    const language = vi.fn(() => 'ja-JP');
    Object.defineProperty(navigator, 'language', { configurable: true, get: language });

    expect(initializeLocale(() => memoryStorage(null))).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(language).not.toHaveBeenCalled();
  });

  it('uses a saved Japanese locale and rejects invalid saved values', () => {
    expect(readLocale(() => memoryStorage('ja'))).toBe('ja');
    expect(readLocale(() => memoryStorage('fr'))).toBe('en');
    expect(readLocale(() => memoryStorage(null))).toBe('en');

    expect(initializeLocale(() => memoryStorage('ja'))).toBe('ja');
    expect(i18n.language).toBe('ja');
    expect(document.documentElement.lang).toBe('ja');
  });

  it('falls back to English when storage cannot be read', () => {
    const inaccessible: LocaleStorageProvider = () => {
      throw new Error('storage access denied');
    };
    const unreadable = () => ({
      getItem: () => {
        throw new Error('storage read denied');
      },
      setItem: () => undefined,
    });

    expect(readLocale(inaccessible)).toBe('en');
    expect(readLocale(unreadable)).toBe('en');
    expect(initializeLocale(inaccessible)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('applies a selected locale immediately and persists it under agboard.locale', () => {
    const storage = memoryStorage(null);

    const result = selectLocale('ja', () => storage);

    expect(result).toEqual({ locale: 'ja', persisted: true });
    expect(storage.setItem).toHaveBeenCalledWith(LOCALE_STORAGE_KEY, 'ja');
    expect(document.documentElement.lang).toBe('ja');
  });

  it('keeps the current page in Japanese when saving the selection fails', async () => {
    const storageError = new Error('storage is full');
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw storageError;
      },
    };
    render(<CountProbe />);
    expect(screen.getByText('2 tasks')).toBeTruthy();

    let result: ReturnType<typeof selectLocale> | undefined;
    await act(async () => {
      result = selectLocale('ja', () => storage);
    });

    expect(result).toEqual({ locale: 'ja', persisted: false, error: storageError });
    expect(document.documentElement.lang).toBe('ja');
    expect(screen.getByText('2件')).toBeTruthy();
  });
});
