import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { Checkbox } from '@/shared/ui/checkbox';
import { RadioGroup } from '@/shared/ui/radio-group';
import {
  KIND_KEYS,
  PERIODIC_INTERVALS,
  STATE_CHANGE_KEYS,
  type NotificationSettings,
  type NotificationSettingsPatch,
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
  const intervalId = useId();
  const { kinds, stateChanges, periodic } = settings;
  return (
    <>
      <div className="notification-settings__group">
        {KIND_KEYS.map((key) => (
          <div key={key}>
            <Option
              checked={kinds[key]}
              label={t(`notifications.kinds.${key}.label`)}
              hint={t(`notifications.kinds.${key}.hint`)}
              onChange={(checked) => onChange({ kinds: { ...kinds, [key]: checked } })}
            />
            {key === 'stateChanges' ? (
              <div
                className="notification-settings__sub"
                role="group"
                aria-label={t('notifications.stateChangesGroup')}
              >
                {STATE_CHANGE_KEYS.map((change) => (
                  <Option
                    key={change}
                    checked={stateChanges[change]}
                    disabled={!kinds.stateChanges}
                    label={t(`notifications.stateChanges.${change}`)}
                    onChange={(checked) =>
                      onChange({ stateChanges: { ...stateChanges, [change]: checked } })
                    }
                  />
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="notification-settings__group">
        <Option
          checked={periodic.enabled}
          label={t('notifications.periodic.label')}
          hint={t('notifications.periodic.hint')}
          onChange={(enabled) => onChange({ periodic: { ...periodic, enabled } })}
        />
        <div className="notification-settings__sub">
          <span className="settings__current" id={intervalId}>
            {t('notifications.periodic.interval')}
          </span>
          <RadioGroup
            className="segmented"
            aria-labelledby={intervalId}
            value={String(periodic.intervalMinutes)}
            disabled={!periodic.enabled}
            onValueChange={(value) => {
              const minutes = PERIODIC_INTERVALS.find((m) => String(m) === value);
              if (minutes !== undefined)
                onChange({ periodic: { ...periodic, intervalMinutes: minutes } });
            }}
          >
            {PERIODIC_INTERVALS.map((minutes) => (
              <RadioGroupPrimitive.Item
                key={minutes}
                value={String(minutes)}
                className="segmented__option"
              >
                {t(`notifications.periodic.intervals.m${minutes}`)}
              </RadioGroupPrimitive.Item>
            ))}
          </RadioGroup>
        </div>
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
