import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { selectLocale, type Locale } from '../i18n';
import { Check, Globe } from './icons';

export function Header({ boardName }: { boardName: string | null }) {
  const { t, i18n } = useTranslation();
  const locale: Locale = i18n.resolvedLanguage === 'ja' ? 'ja' : 'en';
  const [open, setOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedOptionRef = useRef<HTMLButtonElement>(null);
  const languageLabel = t('language.label');

  useEffect(() => {
    if (!open) return;
    selectedOptionRef.current?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !selectorRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const choose = (nextLocale: Locale) => {
    selectLocale(nextLocale);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <header className="header">
      <h1 className="header__app">SimpleKanban</h1>
      {boardName !== null && (
        <>
          <span className="header__slash" aria-hidden="true">
            /
          </span>
          <span className="header__board">{boardName}</span>
        </>
      )}
      <span className="header__spacer" aria-hidden="true" />
      <div className="header__language" ref={selectorRef}>
        <button
          ref={triggerRef}
          type="button"
          className="header__language-trigger"
          aria-label={languageLabel}
          aria-expanded={open}
          aria-controls="language-options"
          onClick={() => setOpen((current) => !current)}
        >
          <Globe />
        </button>
        {open && (
          <div id="language-options" className="language-menu" role="group" aria-label={languageLabel}>
            <span className="language-menu__heading" aria-hidden="true">
              {languageLabel}
            </span>
            <button
              ref={locale === 'en' ? selectedOptionRef : undefined}
              type="button"
              className="language-menu__option"
              aria-pressed={locale === 'en'}
              onClick={() => choose('en')}
            >
              <span>{t('language.english')}</span>
              {locale === 'en' && <Check className="language-menu__check" />}
            </button>
            <button
              ref={locale === 'ja' ? selectedOptionRef : undefined}
              type="button"
              className="language-menu__option"
              aria-pressed={locale === 'ja'}
              onClick={() => choose('ja')}
            >
              <span>{t('language.japanese')}</span>
              {locale === 'ja' && <Check className="language-menu__check" />}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
