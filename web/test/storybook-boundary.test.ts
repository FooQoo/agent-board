import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The checker is a plain script without type declarations.
import { analyze } from '../scripts/check-boundaries.mjs';

const WEB = join(import.meta.dirname, '..');
const read = (relative: string) => readFileSync(join(WEB, relative), 'utf8');

/** Every file under `dir` (relative to web/), as relative paths. */
function filesUnder(dir: string, into: string[] = []): string[] {
  for (const name of readdirSync(join(WEB, dir))) {
    const path = posix.join(dir, name);
    if (statSync(join(WEB, path)).isDirectory()) filesUnder(path, into);
    else into.push(path);
  }
  return into;
}

const productSources = filesUnder('src').filter(
  (path) => /\.(ts|tsx)$/.test(path) && !/\.(stories|test)\.(ts|tsx)$/.test(path),
);
const storyFiles = filesUnder('src').filter((path) => /\.stories\.tsx$/.test(path));

describe('Storybook configuration', () => {
  it('declares the Storybook scripts with their fixed commands', () => {
    const scripts = JSON.parse(read('package.json')).scripts;
    expect(scripts.storybook).toBe('storybook dev -p 8610 -h 127.0.0.1 --no-open --ci');
    expect(scripts['build-storybook']).toBe('storybook build --quiet -o storybook-static');
    expect(scripts['typecheck:storybook']).toBe('tsc -p tsconfig.storybook.json --noEmit');
    expect(scripts['test:storybook']).toBe(
      'vitest run --config vitest.storybook.config.ts --maxWorkers=1 --no-file-parallelism',
    );
    expect(scripts.test).toBe('vitest run');
  });

  it('has the Storybook, preview, Vite and browser test configuration files', () => {
    for (const path of [
      '.storybook/main.ts',
      '.storybook/preview.tsx',
      '.storybook/vite.config.ts',
      '.storybook/vitest.setup.ts',
      '.storybook/support/fixtures.ts',
      '.storybook/support/adapters.ts',
      '.storybook/support/decorators.tsx',
      '.storybook/support/network-guard.ts',
      '.storybook/support/coverage.ts',
      'vitest.storybook.config.ts',
      'tsconfig.storybook.json',
    ]) {
      expect(existsSync(join(WEB, path)), path).toBe(true);
    }
  });

  it('excludes stories from the production type check and includes them in the Storybook one', () => {
    const production = JSON.parse(read('tsconfig.json'));
    expect(production.exclude).toContain('src/**/*.stories.tsx');
    const storybook = JSON.parse(read('tsconfig.storybook.json'));
    expect(storybook.include).toEqual(
      expect.arrayContaining(['src/**/*.stories.tsx', '.storybook']),
    );
  });

  it('ignores the Storybook build output and nothing else', () => {
    expect(read('.gitignore')).toContain('storybook-static/');
  });
});

describe('Storybook stays out of the product code', () => {
  it('has no product module that imports Storybook, its support or a story', () => {
    const offenders = productSources.filter((path) =>
      /from\s+['"](?:[^'"]*\/)?(?:\.storybook|storybook|@storybook\/[^'"]*|[^'"]*\.stories)(?:\/[^'"]*)?['"]/.test(
        read(path),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps the Storybook support out of the product build entries', () => {
    for (const entry of ['index.html', 'monitor.html']) {
      expect(read(entry)).not.toMatch(/storybook/i);
    }
  });
});

describe('representative stories', () => {
  it('sit beside the product parts they show', () => {
    expect(storyFiles).toEqual(
      expect.arrayContaining([
        'src/shared/ui/button.stories.tsx',
        'src/features/tasks/status/StatusLabel.stories.tsx',
        'src/features/tasks/assignee/AssigneeLabel.stories.tsx',
        'src/features/epics/label/EpicLabel.stories.tsx',
        'src/features/tasks/acceptance/AcceptanceProgress.stories.tsx',
        'src/features/tasks/history/HistoryTimeline.stories.tsx',
      ]),
    );
  });

  it('import only the product parts, the Storybook support and Storybook itself', () => {
    for (const story of storyFiles) {
      const imports = [...read(story).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
      for (const spec of imports) {
        const allowed =
          spec.startsWith('.') ||
          spec.startsWith('@/') ||
          spec.startsWith('@storybook/') ||
          spec === 'storybook' ||
          spec === 'react' ||
          spec === 'react-i18next' ||
          spec === 'vitest' ||
          spec === 'lucide-react' ||
          spec === 'storybook/test';
        expect(allowed, `${story} imports ${spec}`).toBe(true);
      }
      expect(read(story), story).not.toMatch(/from\s+['"][^'"]*test\/(?:fixtures|support|setup)/);
    }
  });
});

describe('import rule for Storybook support', () => {
  const support = 'export const fixture = 1;\n';
  it('lets a story or a test use the support', () => {
    const problems = analyze({
      'src/shared/ui/button.tsx': 'export function Button() {}\n',
      'src/shared/ui/button.stories.tsx':
        "import { fixture } from '../../../.storybook/support/fixtures';\n",
      '.storybook/support/fixtures.ts': support,
    });
    expect(problems).toEqual([]);
  });

  it('refuses a product module that imports the support', () => {
    const problems = analyze({
      'src/shared/ui/button.tsx':
        "import { fixture } from '../../../.storybook/support/fixtures';\n",
      '.storybook/support/fixtures.ts': support,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('only stories and tests may use Storybook support');
  });
});
