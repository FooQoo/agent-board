import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { expect, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import type { AcceptanceItem } from '../../../shared/api/contracts';
import type { RichMarkdownEditorHandle } from '../../../shared/rich-editor/RichMarkdownEditor';
import { Button } from '../../../shared/ui/button';
import { EditorBody } from '../../../shared/ui/editor/EditorBody';
import { EditorShell } from '../../../shared/ui/editor/EditorShell';
import { EditorStatus, type EditorStatusLine } from '../../../shared/ui/editor/EditorStatus';
import { StateChip } from '../../../shared/ui/editor/StateChip';
import { ConditionsDock } from '../acceptance/ConditionsDock';

type PreviewState = 'read' | 'locked' | 'readOnly' | 'conflict';

const SAMPLES = {
  ja: {
    heading: 'カード詳細の幅と本文・画像の表示を確認する',
    body: '## 背景と方針\n\nカードの詳細幅を変えて、本文・操作ボタン・確認キャプチャが読みやすく表示されることを確認する。結果と根拠をこのタスクに残す。\n\n## 進め方\n\nタスクを割り当てる。作業・結果を記録する。条件と根拠を確認する。受け入れてDONE。\n',
    conditions: ['タスクの幅を変えても本文が読める', '結果と根拠を記録する'],
  },
  en: {
    heading: 'Check how the task details width, text, and images are displayed',
    body: '## Background and approach\n\nChange the width of the task details and confirm that the text, action buttons, and confirmation capture stay easy to read. Leave the result and evidence on this task.\n\n## How it works\n\nAssign the task. Record the work and results. Check conditions and evidence. Accept and mark Done.\n',
    conditions: ['The text stays readable at any width', 'Record the result and evidence'],
  },
} as const;

/** The task editor as the preview shows it, in one of the four states of the design. */
function TaskPreview({ state }: { state: PreviewState }) {
  const { t, i18n } = useTranslation();
  const sample = SAMPLES[i18n.language === 'ja' ? 'ja' : 'en'];
  const editor = useRef<RichMarkdownEditorHandle>(null);
  const [title, setTitle] = useState<string>(sample.heading);
  const [description, setDescription] = useState<string>(sample.body);
  const [conditions, setConditions] = useState<AcceptanceItem[]>(
    sample.conditions.map((text, index) => ({ id: `AC-${index + 1}`, text, done: index === 0 })),
  );
  const editable = state === 'locked' || state === 'conflict';
  const lines: EditorStatusLine[] = [];
  if (state === 'conflict') lines.push({ tone: 'error', text: t('editor.conflictTask') });
  if (editable) lines.push({ tone: 'lock', text: t('editor.lockedTask') });
  if (state === 'readOnly') lines.push({ tone: 'info', text: t('editor.readOnlyRunning') });
  return (
    <EditorShell
      taskId={14}
      title={t('editor.previewTaskTitle')}
      badge={
        state === 'read' ? '' : <StateChip kind={state === 'readOnly' ? 'running' : 'draft'} />
      }
      variant="edit"
      dialogData={state === 'readOnly' ? { 'data-read-only': '' } : undefined}
      dirty={false}
      saving={false}
      error={null}
      onClose={() => {}}
      status={state === 'read' ? t('editor.noChanges') : <EditorStatus lines={lines} />}
      closeLabel={editable ? undefined : t('dialog.close')}
      actions={
        <Button type="button" disabled={state !== 'locked'}>
          {t('editor.save')}
        </Button>
      }
    >
      <EditorBody
        title={title}
        onTitleChange={setTitle}
        description={description}
        onDescriptionChange={setDescription}
        editorRef={editor}
        disabled={state === 'readOnly'}
        dock={
          <ConditionsDock
            items={conditions}
            onChange={setConditions}
            disabled={state === 'readOnly'}
          />
        }
        asideTop={
          <div className="editor__epic-row">
            <span className="editor__epic-caption">{t('editor.epic')}</span>
            <span className="editor__epic-chip" style={{ background: '#7c3aed', color: '#fff' }}>
              FILE-SHARE
            </span>
          </div>
        }
        attachments={[]}
        onFiles={() => {}}
        onRemoveAttachment={() => {}}
      />
    </EditorShell>
  );
}

const meta = {
  title: 'Task/Editor/PreviewStates',
  component: TaskPreview,
  parameters: modalDocsParameters,
  args: { state: 'read' },
} satisfies Meta<typeof TaskPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

const dialog = () => within(document.body).getByRole('dialog');

/** A. Reading: no change, no chip, Save is off and the button says Close. */
export const Reading: Story = {
  play: async () => {
    const view = within(dialog());
    const footer = within(dialog().querySelector<HTMLElement>('.editor__footer') as HTMLElement);
    await expect(footer.getByRole('button', { name: 'Close' })).toBeEnabled();
    await expect(view.getByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(view.queryByText('Draft')).toBeNull();
  },
};

/** B. Locked: the draft chip, the lock line, Save on, Cancel. */
export const Locked: Story = {
  args: { state: 'locked' },
  play: async () => {
    const view = within(dialog());
    await expect(view.getByText('Draft')).toBeInTheDocument();
    await expect(view.getByText(/Agents can't change this task/)).toBeInTheDocument();
    await expect(view.getByRole('button', { name: 'Save' })).toBeEnabled();
    await expect(view.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  },
};

/** C. Read-only while an agent works: the running chip, the reason, input off. */
export const ReadOnly: Story = {
  args: { state: 'readOnly' },
  play: async () => {
    const view = within(dialog());
    await expect(view.getByText('Running')).toBeInTheDocument();
    await expect(view.getByText('Read-only while an agent is working.')).toBeInTheDocument();
    await expect(view.getByRole('textbox', { name: 'Title' })).toBeDisabled();
    await expect(view.getByRole('button', { name: 'Save' })).toBeDisabled();
  },
};

/** D. Conflict: the error line over the lock line, Save off. */
export const Conflict: Story = {
  args: { state: 'conflict' },
  play: async () => {
    const view = within(dialog());
    await expect(
      view.getByText(/An agent changed this task while it was open/),
    ).toBeInTheDocument();
    await expect(view.getByText(/Agents can't change this task/)).toBeInTheDocument();
    await expect(view.getByRole('button', { name: 'Save' })).toBeDisabled();
  },
};
