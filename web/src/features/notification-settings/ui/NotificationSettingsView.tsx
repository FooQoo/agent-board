import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/shared/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import {
  KIND_KEYS,
  type NotificationSettings,
  type NotificationSettingsPatch,
  SUMMARY_INTERVALS,
  type SummaryInterval,
} from '../model';
import type { NotificationSettingsState } from '../useNotificationSettings';
import './notification-settings.css';

function Option({
  checked,
  disabled,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  hint?: string;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="notification-settings__option">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <label htmlFor={id} className="notification-settings__label">
        {label}
        {hint ? <span className="notification-settings__hint">{hint}</span> : null}
      </label>
    </div>
  );
}

function Loaded({
  settings,
  onChange,
}: {
  settings: NotificationSettings;
  onChange: (patch: NotificationSettingsPatch) => void;
}) {
  const { t } = useTranslation();
  const { kinds } = settings;
  const intervalId = useId();
  return (
    <>
      <div className="notification-settings__group">
        {KIND_KEYS.map((key) => (
          <Option
            key={key}
            checked={kinds[key]}
            label={t(`notifications.kinds.${key}.label`)}
            hint={t(`notifications.kinds.${key}.hint`)}
            onChange={(checked) => onChange({ kinds: { ...kinds, [key]: checked } })}
          />
        ))}
      </div>
      <div className="notification-settings__group" data-notification-summary-interval="">
        <span className="notification-settings__label" id={intervalId}>
          {t('notifications.summaryInterval.label')}
          <span className="notification-settings__hint">
            {t('notifications.summaryInterval.hint')}
          </span>
        </span>
        <RadioGroup
          aria-labelledby={intervalId}
          value={String(settings.summary.intervalMinutes)}
          onValueChange={(value) =>
            onChange({ summary: { intervalMinutes: Number(value) as SummaryInterval } })
          }
          className="notification-settings__intervals"
        >
          {SUMMARY_INTERVALS.map((minutes) => (
            <div className="notification-settings__option" key={minutes}>
              <RadioGroupItem value={String(minutes)} id={`${intervalId}-${minutes}`} />
              <label htmlFor={`${intervalId}-${minutes}`} className="notification-settings__label">
                {t(`notifications.summaryInterval.options.${minutes}`)}
              </label>
            </div>
          ))}
        </RadioGroup>
      </div>
    </>
  );
}

/** The choices of the "Phone notifications" dialog, drawn from a loaded state. */
export function NotificationSettingsView({
  state,
  onChange,
}: {
  state: NotificationSettingsState;
  onChange: (patch: NotificationSettingsPatch) => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      className="settings__section notification-settings"
      aria-label={t('notifications.title')}
      data-notification-settings=""
    >
      <p className="notification-settings__intro">{t('notifications.intro')}</p>
      {state.status === 'loading' ? (
        <p className="notification-settings__intro">{t('notifications.loading')}</p>
      ) : null}
      {state.status === 'failed' ? (
        <p className="modal__error" role="alert">
          {t('notifications.loadFailed')}
        </p>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <Loaded settings={state.settings} onChange={onChange} />
          {state.saveFailed ? (
            <p className="modal__error" role="alert">
              {t('dialog.saveFailed')}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
