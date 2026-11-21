import { HashIcon, ImageIcon, SendIcon, XIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../../features/messages/ask/ask-ai.css';
import { Button } from '../../shared/ui/button';
import { Textarea } from '../../shared/ui/textarea';
import { BASE_TEXT, openToken, splitTrailing, withTasks } from './data';
import { FullPicker, SheetPicker, Suggestions } from './Pickers';
import { useLocale, useMockText } from './text';
import './task-attach-mock.css';

export type PickerOption = 'sheet' | 'inline' | 'full';
export type Stage = 'composer' | 'picker' | 'result';

export interface TaskAttachScreenProps {
  variant: 'desktop' | 'phone';
  /** A: popover / bottom sheet with checkboxes. B: inline `#` autocomplete. C: full-screen grouped picker. */
  option: PickerOption;
  /** Which moment the story starts in; every stage stays interactive. */
  stage: Stage;
  /** Text the composer starts with, to show how an existing last line is replaced. */
  initialText?: string;
}

function startText(
  option: PickerOption,
  stage: Stage,
  locale: 'ja' | 'en',
  given?: string,
): string {
  if (given !== undefined) return given;
  const base = BASE_TEXT[locale];
  if (stage === 'result') return `${base}\n#552 #651`;
  if (stage === 'picker' && option === 'inline') return `${base}\n#552 #6`;
  return base;
}

export function TaskAttachScreen({ variant, option, stage, initialText }: TaskAttachScreenProps) {
  const { t } = useTranslation();
  const m = useMockText();
  const locale = useLocale();
  const [text, setText] = useState(() => startText(option, stage, locale, initialText));
  const [open, setOpen] = useState(stage === 'picker' && option !== 'inline');
  // The picker works on a draft of the ids found on the last line, so re-opening reflects the text.
  const [draft, setDraft] = useState<number[]>(() =>
    stage === 'picker' && option !== 'inline' ? [552, 651] : splitTrailing(text).ids,
  );
  const field = useRef<HTMLTextAreaElement>(null);
  const attached = splitTrailing(text).ids;
  const token = option === 'inline' ? openToken(text) : null;

  const toggle = (id: number) =>
    setDraft((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const openPicker = () => {
    if (option === 'inline') {
      // Continue the existing last line, or start a new one; the picker is the field itself.
      setText((cur) => {
        const { ids } = splitTrailing(cur);
        const trimmed = cur.replace(/\s+$/, '');
        return ids.length > 0 ? `${trimmed} #` : `${trimmed}\n#`;
      });
      field.current?.focus();
      return;
    }
    setDraft(attached);
    setOpen(true);
  };
  const confirm = () => {
    setText((cur) => withTasks(cur, draft));
    setOpen(false);
  };
  const pick = (id: number) => setText((cur) => cur.replace(/#[^\s#]*$/, `#${id} `));

  return (
    <div className={`ta-root ta-root--${variant}`}>
      <div className="ta-backdrop" />
      <section className={`ta-panel ask-ai ta-panel--${variant}`} aria-label={t('askAi.title')}>
        {variant === 'phone' && <span className="ta-grab" aria-hidden="true" />}
        <header className="ta-panel__head">
          <strong>{t('askAi.title')}</strong>
          <button type="button" className="ta-icon" aria-label={t('dialog.close')}>
            <XIcon aria-hidden="true" />
          </button>
        </header>
        <div className="ask-ai__body ta-panel__body">
          <Textarea
            ref={field}
            className="ask-ai__input"
            aria-label={t('askAi.prompt')}
            placeholder={t('askAi.prompt')}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <footer className="ta-panel__foot">
          {token !== null && <Suggestions query={token} taken={attached} onPick={pick} />}
          <div className="ask-ai__toolbar">
            <div className="ta-tools">
              <Button type="button" variant="ghost">
                <ImageIcon aria-hidden="true" />
                {t('askAi.image')}
              </Button>
              <Button type="button" variant="ghost" onClick={openPicker} aria-expanded={open}>
                <HashIcon aria-hidden="true" />
                {attached.length > 0 ? m.attachCount(attached.length) : m.attach}
              </Button>
            </div>
            <Button type="button">
              <SendIcon aria-hidden="true" />
              {t('askAi.submit')}
            </Button>
          </div>
          {open && option === 'sheet' && variant === 'desktop' && (
            <SheetPicker
              variant="desktop"
              draft={draft}
              toggle={toggle}
              onConfirm={confirm}
              onClose={() => setOpen(false)}
            />
          )}
        </footer>
      </section>
      {open && option === 'sheet' && variant === 'phone' && (
        <>
          <div className="ta-backdrop ta-backdrop--top" />
          <SheetPicker
            variant="phone"
            draft={draft}
            toggle={toggle}
            onConfirm={confirm}
            onClose={() => setOpen(false)}
          />
        </>
      )}
      {open && option === 'full' && (
        <>
          {variant === 'desktop' && <div className="ta-backdrop ta-backdrop--top" />}
          <FullPicker
            variant={variant}
            draft={draft}
            toggle={toggle}
            onConfirm={confirm}
            onClose={() => setOpen(false)}
          />
        </>
      )}
    </div>
  );
}
