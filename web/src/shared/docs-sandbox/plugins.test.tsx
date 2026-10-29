import { evaluate } from '@mdx-js/mdx';
import * as runtime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { REMARK_PLUGINS } from './plugins';
import { UNREGISTERED } from './unregistered';

/** The HTML the sandbox draws for an MDX source, with the unregistered part shown by its name. */
async function render(source: string): Promise<string> {
  const { default: Content } = await evaluate(source, {
    ...runtime,
    remarkPlugins: REMARK_PLUGINS,
  });
  const Unregistered = ({ name }: { name: string }) => <span data-unregistered={name} />;
  return renderToStaticMarkup(<Content components={{ [UNREGISTERED]: Unregistered }} />);
}

describe('REMARK_PLUGINS', () => {
  it('draws a Markdown table as a table, as in a .md file', async () => {
    const html = await render('| Axis | Score |\n| --- | --- |\n| Local | 5 |\n');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Axis</th>');
    expect(html).toContain('<td>Local</td>');
  });

  it('draws task lists and strikethrough', async () => {
    const html = await render('- [x] Done\n- [ ] Open\n\n~~old~~\n');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<del>old</del>');
  });

  it('still swaps a part that is not registered, next to a table', async () => {
    const html = await render('| A |\n| --- |\n| 1 |\n\n<Chart />\n');
    expect(html).toContain('<table>');
    expect(html).toContain('data-unregistered="Chart"');
  });
});
