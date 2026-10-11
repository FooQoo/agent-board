import { TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Problem } from '../../types';

/**
 * The format defects of a card's files, above its body. The text is shown as written; the product does not
 * rewrite the file. Each problem names the file, the item and the reason.
 */
export function ProblemNotice({ problems }: { problems: readonly Problem[] }) {
  const { t } = useTranslation();
  if (problems.length === 0) return null;
  return (
    <div className="detail__problems" role="alert">
      {problems.map((problem) => (
        <p className="detail__problem" key={`${problem.file}:${problem.field}:${problem.reason}`}>
          <TriangleAlertIcon aria-hidden="true" />
          <span>
            {problem.field === ''
              ? t('detail.problemNoField', { file: problem.file, reason: problem.reason })
              : t('detail.problem', {
                  file: problem.file,
                  field: problem.field,
                  reason: problem.reason,
                })}
          </span>
        </p>
      ))}
    </div>
  );
}
