import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { splitSections } from '../../lib/markdown';
import { MarkdownView, type MarkdownVariant } from './MarkdownView';

/**
 * A description as chapters: each H2 is a numbered heading over its body, and no chapter folds. The number
 * is made here from the order of the H2s, so it is never written into the text. A description without an H2
 * is shown whole.
 */
export function MarkdownSections({
  source,
  variant = 'compact',
  resolveAttachment,
}: {
  source: string;
  variant?: MarkdownVariant;
  resolveAttachment?: (id: string) => string | null;
}) {
  const { t } = useTranslation();
  const { preamble, sections } = useMemo(() => splitSections(source), [source]);

  if (source.trim() === '') {
    return <p className="md-empty">{t('detail.noDescription')}</p>;
  }
  if (sections.length === 0)
    return (
      <MarkdownView source={preamble} variant={variant} resolveAttachment={resolveAttachment} />
    );

  return (
    <div className={`md-sections md-sections--${variant}`}>
      {preamble !== '' && (
        <MarkdownView source={preamble} variant={variant} resolveAttachment={resolveAttachment} />
      )}
      {sections.map((section, index) => (
        <Chapter key={`${index}:${section.title}`} title={section.title}>
          {section.markdown !== '' && (
            <MarkdownView
              source={section.markdown}
              variant={variant}
              resolveAttachment={resolveAttachment}
            />
          )}
        </Chapter>
      ))}
    </div>
  );
}

function Chapter({ title, children }: { title: string; children: React.ReactNode }) {
  const headingId = useId();
  return (
    <section className="md-chapter" aria-labelledby={headingId}>
      <header className="md-chapter__head">
        <h3 className="md-chapter__title" id={headingId}>
          {title}
        </h3>
      </header>
      {children}
    </section>
  );
}
