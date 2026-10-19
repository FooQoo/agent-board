import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon, XIcon } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog';
import { RadioGroup } from '@/shared/ui/radio-group';
import '../../../shared/styles/modal.css';
import { selectLocale, type Locale } from '../../../shared/i18n';
import {
  ACCENTS,
  MODES,
  selectTheme,
  type Accent,
  type Mode,
  type Theme,
} from '../../../shared/theme';

/**
 * Colors of one theme swatch tile. The tile of a mode is drawn on that mode's page background
 * and shows the accent of that theme, so every swatch looks the same whichever theme is current.
 * The values mirror theme.css (--r-bg per mode, --r-accent per mode and accent); a unit test
 * keeps them in step.
 */
export const THEME_SWATCHES: Record<string, { bg: string; accent: string }> = Object.fromEntries(
  (
    [
      [
        'light',
        '#f6f7f9',
        [
          '#2563eb',
          '#0284c7',
          '#0891b2',
          '#0d9488',
          '#16a34a',
          '#65a30d',
          '#ca8a04',
          '#ea580c',
          '#dc2626',
          '#db2777',
          '#7c3aed',
          '#475569',
        ],
      ],
      [
        'dark',
        '#0f1318',
        [
          '#6b9aff',
          '#4db5f0',
          '#3cc9e0',
          '#3dcbb8',
          '#4cc97a',
          '#a3d94a',
          '#f0c531',
          '#f59a52',
          '#f47c7c',
          '#f472b6',
          '#a78bfa',
          '#94a3b8',
        ],
      ],
    ] as const
  ).flatMap(([mode, bg, accents]) =>
    ACCENTS.map((accent, index) => [`${mode}-${accent}`, { bg, accent: accents[index] ?? '' }]),
  ),
);

const LOCALES: readonly Locale[] = ['ja', 'en'];

function isMode(value: string | undefined): value is Mode {
  return (MODES as readonly (string | undefined)[]).includes(value);
}

function isAccent(value: string | undefined): value is Accent {
  return (ACCENTS as readonly (string | undefined)[]).includes(value);
}

/** The theme currently applied to the page (it stays correct when saving failed). */
function currentTheme(): Theme {
  const { mode, accent } = document.documentElement.dataset;
  return { mode: isMode(mode) ? mode : 'light', accent: isAccent(accent) ? accent : 'blue' };
}

function themeValue(theme: Theme): string {
  return `${theme.mode}-${theme.accent}`;
}

/** A radio that also selects on Enter, as the dialog is keyboard operated. */
function selectOnEnter(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.currentTarget.click();
  }
}

export function SettingsDialog({
  open,
  onOpenChange,
  restoreFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the focus goes when the dialog closes (the settings button). */
  restoreFocusRef?: { current: HTMLElement | null };
}) {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const openerRef = useRef<Element | null>(null);
  const languageId = useId();
  const themeId = useId();
  const locale: Locale = i18n.resolvedLanguage === 'ja' ? 'ja' : 'en';
  const themeName = (value: Theme) =>
    t('settings.themeName', {
      mode: t(`settings.${value.mode}`),
      color: t(`settings.colors.${value.accent}`),
    });

  useEffect(() => {
    if (open) setTheme(currentTheme());
  }, [open]);

  const chooseTheme = (value: string) => {
    const [mode, accent] = value.split('-');
    if (!isMode(mode) || !isAccent(accent)) return;
    selectTheme({ mode, accent });
    setTheme({ mode, accent });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="modal settings-dialog"
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          openerRef.current = document.activeElement;
          document
            .querySelector<HTMLElement>('[data-language-group] [role="radio"][aria-checked="true"]')
            ?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = restoreFocusRef?.current ?? openerRef.current;
          if (target instanceof HTMLElement && target.isConnected) target.focus();
        }}
      >
        <div className="modal__header">
          <DialogTitle className="modal__title">{t('settings.title')}</DialogTitle>
          <button
            type="button"
            className="modal__close"
            aria-label={t('dialog.close')}
            onClick={() => onOpenChange(false)}
          >
            <XIcon aria-hidden="true" />
          </button>
        </div>

        <section className="settings__section settings__section--language">
          <h3 className="settings__heading" id={languageId}>
            {t('settings.language')}
          </h3>
          <RadioGroup
            className="segmented"
            data-language-group=""
            aria-labelledby={languageId}
            value={locale}
            onValueChange={(value) => selectLocale(value === 'ja' ? 'ja' : 'en')}
          >
            {LOCALES.map((value) => (
              <RadioGroupPrimitive.Item
                key={value}
                value={value}
                className="segmented__option"
                onKeyDown={selectOnEnter}
              >
                {value === 'ja' ? t('language.japanese') : t('language.english')}
              </RadioGroupPrimitive.Item>
            ))}
          </RadioGroup>
        </section>

        <section className="settings__section settings__section--theme">
          <div className="settings__heading-row">
            <h3 className="settings__heading" id={themeId}>
              {t('settings.theme')}
            </h3>
            <span className="settings__current">{themeName(theme)}</span>
          </div>
          <RadioGroup
            className="theme-rows"
            aria-labelledby={themeId}
            value={themeValue(theme)}
            onValueChange={chooseTheme}
          >
            {MODES.map((mode) => (
              <div className="theme-row" key={mode}>
                <span className="theme-row__mode">{t(`settings.${mode}`)}</span>
                <div className="theme-row__tiles">
                  {ACCENTS.map((accent) => {
                    const value = themeValue({ mode, accent });
                    const swatch = THEME_SWATCHES[value];
                    return (
                      <RadioGroupPrimitive.Item
                        key={value}
                        value={value}
                        className="theme-tile"
                        aria-label={themeName({ mode, accent })}
                        title={themeName({ mode, accent })}
                        style={
                          {
                            '--tile-bg': swatch?.bg,
                            '--tile-accent': swatch?.accent,
                          } as CSSProperties
                        }
                        onKeyDown={selectOnEnter}
                      >
                        <span className="theme-tile__dot" aria-hidden="true" />
                        <CheckIcon className="theme-tile__check" aria-hidden="true" />
                      </RadioGroupPrimitive.Item>
                    );
                  })}
                </div>
              </div>
            ))}
          </RadioGroup>
        </section>

        <p className="settings__note">{t('settings.note')}</p>
      </DialogContent>
    </Dialog>
  );
}
