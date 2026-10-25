/**
 * Splits a leading `---` block from the Markdown body. `frontmatter + body` always equals the
 * source. Only a block that opens on the first line and closes on a later `---` or `...` line
 * counts; CRLF sources, a leading blank line, and an unclosed block are all treated as having none.
 */
export function splitFrontmatter(source: string): { frontmatter: string; body: string } {
  if (!source.startsWith('---\n')) return { frontmatter: '', body: source };
  let lineStart = 4;
  while (lineStart <= source.length) {
    const newline = source.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? source.length : newline;
    const line = source.slice(lineStart, lineEnd);
    if (line === '---' || line === '...') {
      const end = newline === -1 ? source.length : newline + 1;
      return { frontmatter: source.slice(0, end), body: source.slice(end) };
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return { frontmatter: '', body: source };
}
