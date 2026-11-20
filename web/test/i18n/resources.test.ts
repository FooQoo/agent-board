// @vitest-environment node
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import { resources } from '../../src/shared/i18n/resources';

function leafPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('dialog texts', () => {
  it('uses the design wording for the editor buttons', () => {
    expect(resources.ja.translation.editor.save).toBe('保存');
    expect(resources.ja.translation.editor.discardAndMove).toBe('破棄して移動');
    expect(resources.en.translation.answer.open).toBe('Answer the question');
    expect(resources.ja.translation.draft.finalize).toBe('確定する');
  });
});

describe('translation resources', () => {
  it('provides matching English and Japanese keys', () => {
    expect(leafPaths(resources.en.translation).sort()).toEqual(
      leafPaths(resources.ja.translation).sort(),
    );
  });

  it('translates counts and interpolates values in both languages', async () => {
    const i18n = createInstance();
    await i18n.init({
      resources,
      lng: 'en',
      fallbackLng: 'en',
      defaultNS: 'translation',
      initAsync: false,
      interpolation: { escapeValue: false },
    });
    const english = i18n.getFixedT('en');
    const japanese = i18n.getFixedT('ja');

    expect(english('status.cardCount', { count: 1 })).toBe('1 task');
    expect(english('status.cardCount', { count: 8 })).toBe('8 tasks');
    expect(japanese('status.cardCount', { count: 1 })).toBe('1件');
    expect(japanese('status.cardCount', { count: 8 })).toBe('8件');
    expect(english('card.updated', { date: '10/02 10:08' })).toBe('Updated 10/02 10:08');
    expect(japanese('card.updated', { date: '10/02 10:08' })).toBe('更新 10/02 10:08');
    expect(japanese('delete.confirm', { id: 4, title: '日本語のタスク' })).toBe(
      '#4「日本語のタスク」を削除しますか？ 本文・画像・履歴も削除されます。この操作は元に戻せません。',
    );
  });

  it('falls back to English when a Japanese key is missing', async () => {
    const i18n = createInstance();
    await i18n.init({
      resources: { en: resources.en, ja: { translation: {} } },
      lng: 'ja',
      fallbackLng: 'en',
      defaultNS: 'translation',
      initAsync: false,
    });

    expect(i18n.t('column.todo')).toBe('Todo');
  });
});
