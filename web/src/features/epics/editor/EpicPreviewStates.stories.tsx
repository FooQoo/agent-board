import type { Meta, StoryObj } from '@storybook/react-vite';
import { ListOrderedIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { expect, within } from 'storybook/test';
import { makeTask } from '../../../../.storybook/support/fixtures';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import type { RichMarkdownEditorHandle } from '../../../shared/rich-editor/RichMarkdownEditor';
import { Button } from '../../../shared/ui/button';
import { CollapsibleSection } from '../../../shared/ui/editor/CollapsibleSection';
import { EditorBody } from '../../../shared/ui/editor/EditorBody';
import { EditorShell } from '../../../shared/ui/editor/EditorShell';
import { EditorStatus } from '../../../shared/ui/editor/EditorStatus';
import { StateChip } from '../../../shared/ui/editor/StateChip';
import { epicInk } from '../model/epic';
import { EpicProgressList } from './EpicProgressList';

const SAMPLES = {
  ja: {
    heading: '進行表と自動完了によるAIの操作削減',
    body: '## 目的・背景\n\nAIが進行表から作業を選び、必要な計画と作業記録を参照できるようにする。判断待ちの作業を除いて、次の作業へ進める。\n\n## スコープ\n\n進行表、プロジェクトとフォルダの紐付け、受け入れ条件による自動完了を対象にする。\n\n## 進め方\n\nタスク一覧の順序が、このエピックの進行順になる。タスク名から既存のタスク詳細を開き、作業内容と確認結果を読む。\n',
    tasks: [
      'フォルダとプロジェクトの紐付けを作る',
      '回答と再開の接続を確認する',
      '進行表をHookへ接続する',
    ],
  },
  en: {
    heading: 'Fewer agent operations with a progress table and automatic completion',
    body: '## Goal\n\nLet agents pick work from the progress table and read the plans and records they need. Skip work that waits for a decision and move on to the next.\n\n## Scope\n\nThe progress table, the link between a project and a folder, and automatic completion by acceptance conditions.\n\n## How it works\n\nThe order of the task list is the order of work in this epic. Open the existing task details from a task name and read the work and its results.\n',
    tasks: [
      'Link folders and projects',
      'Check the connection between answers and resume',
      'Connect the progress table to the hook',
    ],
  },
} as const;

/** The epic editor as the preview shows it while the draft lock is held. */
function EpicPreview() {
  const { t, i18n } = useTranslation();
  const sample = SAMPLES[i18n.language === 'ja' ? 'ja' : 'en'];
  const editor = useRef<RichMarkdownEditorHandle>(null);
  const [name, setName] = useState<string>(sample.heading);
  const [body, setBody] = useState<string>(sample.body);
  const [open, setOpen] = useState(true);
  const rows = sample.tasks.map((title, index) =>
    makeTask({ id: [24, 26, 25][index] ?? index, title }),
  );
  return (
    <EditorShell
      idLabel="PROGRESS-TABLE"
      title={t('editor.previewEpicTitle')}
      badge={<StateChip kind="draft" />}
      variant="edit"
      dirty={false}
      saving={false}
      error={null}
      onClose={() => {}}
      status={<EditorStatus lines={[{ tone: 'lock', text: t('editor.lockedEpic') }]} />}
      actions={<Button type="button">{t('editor.save')}</Button>}
    >
      <EditorBody
        title={name}
        onTitleChange={setName}
        titleLabel={t('epic.nameLabel')}
        description={body}
        onDescriptionChange={setBody}
        bodyLabel={t('epic.documentLabel')}
        editorRef={editor}
        disabled={false}
        asideTop={
          <div className="epic-label-row">
            <span className="editor__epic-caption">{t('epic.label')}</span>
            <span
              className="editor__epic-chip"
              style={{ background: '#7c3aed', color: epicInk('#7c3aed') }}
            >
              PROGRESS-TABLE
            </span>
          </div>
        }
        sidebar={
          <CollapsibleSection
            title={t('epic.progressTitle')}
            count={rows.length}
            open={open}
            onToggle={() => setOpen(!open)}
            icon={
              <ListOrderedIcon aria-hidden="true" focusable="false" className="collapsible__icon" />
            }
          >
            <EpicProgressList
              tasks={rows}
              disabled={false}
              onMove={() => {}}
              onOpenTask={() => {}}
              renderTask={(task, row) => (
                <div className="card__top">
                  {row.grip}
                  <span className="card__id">#{task.id}</span>
                  <span className="epic-progress__name">{task.title}</span>
                </div>
              )}
            />
          </CollapsibleSection>
        }
        attachments={[]}
        onFiles={() => {}}
        onRemoveAttachment={() => {}}
      />
    </EditorShell>
  );
}

const meta = {
  title: 'Epic/Editor/PreviewStates',
  component: EpicPreview,
  parameters: modalDocsParameters,
} satisfies Meta<typeof EpicPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** F. The epic preview while the draft lock is held. */
export const Locked: Story = {
  play: async () => {
    const view = within(document.body.querySelector<HTMLElement>('[role=dialog]') as HTMLElement);
    await expect(view.getByText('Draft')).toBeInTheDocument();
    await expect(view.getByText(/Agents can't change this epic/)).toBeInTheDocument();
    await expect(view.getByText('Epic preview')).toBeInTheDocument();
  },
};
