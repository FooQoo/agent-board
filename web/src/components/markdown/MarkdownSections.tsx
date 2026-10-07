import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { splitSections } from '../../lib/markdown';
import { MarkdownView, type MarkdownVariant } from './MarkdownView';
import { SectionFold } from './SectionFold';

/**
 * A description folded at its H2 headings. Every section is open at first and only the reader
 * closes one. The open state lives here, so a new `key` (another card) opens everything again.
 * A description without an H2 is shown whole.
 */
export function MarkdownSections({
  source,
  variant = 'compact',
}: {
  source: string;
  variant?: MarkdownVariant;
}) {
  const { t } = useTranslation();
  const { preamble, sections } = useMemo(() => splitSections(source), [source]);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());

  if (source.trim() === '') {
    return <p className="md-empty">{t('detail.noDescription')}</p>;
  }
  if (sections.length === 0) return <MarkdownView source={preamble} variant={variant} />;

  const toggle = (id: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className={`md-sections md-sections--${variant}`}>
      {preamble !== '' && <MarkdownView source={preamble} variant={variant} />}
      {sections.map((section, index) => {
        const id = `${index}:${section.title}`;
        return (
          <SectionFold
            key={id}
            title={section.title}
            count={section.count}
            open={!closed.has(id)}
            onToggle={() => toggle(id)}
          >
            {section.markdown !== '' && (
              <MarkdownView source={section.markdown} variant={variant} />
            )}
          </SectionFold>
        );
      })}
    </div>
  );
}
