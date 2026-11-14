import '@/shared/i18n/question-flow-strings';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import './answer-flow.css';

/** The place of a question that is not read yet, or could not be read. */
export function QuestionLoading({
  state,
  onReload,
}: {
  state: 'loading' | 'failed';
  onReload: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="question-loading" role="status">
      <span>{t(state === 'loading' ? 'questions.flow.loading' : 'questions.flow.loadFailed')}</span>
      {state === 'failed' && (
        <Button type="button" variant="outline" size="s" onClick={onReload}>
          {t('questions.flow.reload')}
        </Button>
      )}
    </div>
  );
}
