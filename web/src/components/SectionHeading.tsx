export function SectionHeading({ children }: { children: string }) {
  return (
    <div className="section-heading">
      <span className="section-heading__bar" aria-hidden="true" />
      <h3 className="section-heading__label">{children}</h3>
      <div className="rule rule--section" aria-hidden="true">
        <span className="rule__line" />
        <span className="rule__end" />
      </div>
    </div>
  );
}
