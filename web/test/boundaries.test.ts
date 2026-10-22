import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The checker is a plain script without type declarations.
import { analyze, violation } from '../scripts/check-boundaries.mjs';

function sourcesOf(dir: string, into: Record<string, string> = {}) {
  for (const name of readdirSync(join(import.meta.dirname, '..', dir))) {
    const path = posix.join(dir, name);
    if (statSync(join(import.meta.dirname, '..', path)).isDirectory()) sourcesOf(path, into);
    else into[path] = readFileSync(join(import.meta.dirname, '..', path), 'utf8');
  }
  return into;
}

describe('layer rules', () => {
  it('allows the same feature and lower layers', () => {
    expect(
      violation('src/pages/board/ui/Lane.tsx', 'src/features/tasks/card/TaskCard.tsx'),
    ).toBeNull();
    expect(
      violation('src/features/tasks/card/TaskCard.tsx', 'src/features/tasks/model/format.ts'),
    ).toBeNull();
    expect(
      violation('src/features/tasks/card/TaskCard.tsx', 'src/shared/ui/button.tsx'),
    ).toBeNull();
    expect(violation('src/app/App.tsx', 'src/pages/board/ui/Board.tsx')).toBeNull();
  });

  it('refuses shared importing up, a feature importing a feature, and a page importing a page', () => {
    expect(
      violation('src/shared/ui/app-header/Header.tsx', 'src/features/projects/api.ts'),
    ).not.toBeNull();
    expect(
      violation('src/features/tasks/card/TaskCard.tsx', 'src/features/epics/label/EpicLabel.tsx'),
    ).not.toBeNull();
    expect(violation('src/features/tasks/api/read.ts', 'src/app/api.ts')).not.toBeNull();
    expect(
      violation('src/pages/archive/ui/ArchiveList.tsx', 'src/pages/board/ui/Board.tsx'),
    ).not.toBeNull();
    expect(
      violation('src/pages/monitor/App.tsx', 'src/app/model/useBuildReload.ts'),
    ).not.toBeNull();
  });
});

describe('import scan', () => {
  const files = (extra: Record<string, string>) => ({
    'src/shared/ui/button.tsx': 'export const Button = 1;',
    'src/features/epics/label/EpicLabel.tsx': 'export const EpicLabel = 1;',
    ...extra,
  });

  it('follows static, type-only, re-export and dynamic imports', () => {
    for (const line of [
      "import { EpicLabel } from '../../epics/label/EpicLabel';",
      "import type { EpicLabel } from '../../epics/label/EpicLabel';",
      "export { EpicLabel } from '@/features/epics/label/EpicLabel';",
      "const load = () => import('../../epics/label/EpicLabel');",
      "type T = typeof import('../../epics/label/EpicLabel');",
    ]) {
      const problems = analyze(files({ 'src/features/tasks/card/TaskCard.tsx': line }));
      expect(problems, line).toHaveLength(1);
    }
  });

  it('ignores a path in a comment', () => {
    const problems = analyze(
      files({
        'src/features/tasks/card/TaskCard.tsx': "// import x from '../../epics/label/EpicLabel';",
      }),
    );
    expect(problems).toEqual([]);
  });

  it('reports an import it cannot resolve and an import cycle', () => {
    expect(
      analyze(files({ 'src/features/tasks/card/TaskCard.tsx': "import '../missing';" })),
    ).toHaveLength(1);
    const cyc = analyze({
      'src/shared/lib/a.ts': "import type { B } from './b';",
      'src/shared/lib/b.ts': "import type { A } from './a';",
    });
    expect(cyc.filter((line: string) => line.startsWith('import cycle'))).toHaveLength(1);
  });
});

describe('shared/data rules', () => {
  const data = (text: string, extra: Record<string, string> = {}) =>
    analyze({
      'src/shared/data/core/a.ts': text,
      'src/shared/rich-editor/editor.ts': 'export const e = 1;',
      'src/shared/lib/x.ts': 'export const x = 1;',
      'src/features/tasks/t.ts': 'export const t = 1;',
      'src/app/m.ts': 'export const m = 1;',
      'src/pages/p/p.ts': 'export const p = 1;',
      ...extra,
    });

  it('allows the data layer to use lower shared code and packages', () => {
    expect(data("import { x } from '../../lib/x';\nimport 'react';")).toEqual([]);
  });

  it('refuses pages, features, app, the rich editor and the heavy rendering libraries', () => {
    for (const line of [
      "import { t } from '../../../features/tasks/t';",
      "import { m } from '../../../app/m';",
      "import { p } from '../../../pages/p/p';",
      "import { e } from '../../rich-editor/editor';",
      "import mermaid from 'mermaid';",
      "import('mermaid/dist/mermaid.core');",
      "import Markdown from 'react-markdown';",
    ]) {
      expect(data(line), line).toHaveLength(1);
    }
  });

  it('does not apply to code outside shared/data', () => {
    expect(analyze({ 'src/shared/lib/y.ts': "import mermaid from 'mermaid';" })).toEqual([]);
  });
});

describe('web/src', () => {
  it('has no layer violation and no import cycle', () => {
    expect(analyze(sourcesOf('src', sourcesOf('.storybook')))).toEqual([]);
  });

  it('keeps none of the old folders', () => {
    const top = readdirSync(join(import.meta.dirname, '../src')).sort();
    expect(top).toEqual(['app', 'features', 'pages', 'shared']);
  });
});
