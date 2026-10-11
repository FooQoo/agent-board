import { FileTextIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { EvidenceRecord } from '../../types';

export function DetailEvidence({
  evidence,
  evidenceUrl,
}: {
  evidence: readonly EvidenceRecord[];
  evidenceUrl?: (id: string) => string;
}) {
  const { t } = useTranslation();
  if (evidence.length === 0) return null;
  return (
    <section className="detail-evidence" aria-label={t('monitor.evidence')}>
      <h3>
        {t('monitor.evidence')} · {evidence.length}
      </h3>
      <ul>
        {evidence.map((item) => (
          <li key={item.id}>
            <FileTextIcon aria-hidden="true" />
            {evidenceUrl ? (
              <a href={evidenceUrl(item.id)} target="_blank" rel="noreferrer">
                {item.name}
              </a>
            ) : (
              <span>{item.name}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
