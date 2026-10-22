import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export type Lang = 'en' | 'ja';

// Sidebar order of the guide, from the site's information architecture. The first group
// sits at the chapter root and the other groups are folders.
export const guideFiles = [
  'index',
  'getting-started',
  'quickstart',
  'concepts',
  'use/board',
  'use/decisions',
  'use/epics',
  'use/editing',
  'use/docs',
  'automation/agents',
  'automation/cli',
  'automation/file-format',
  'operations/mobile-monitor',
  'operations/data',
  'operations/troubleshooting',
] as const;

// Sidebar order of the developer chapter.
export const devFiles = [
  'index',
  'getting-started/setup',
  'getting-started/first-change',
  'getting-started/pull-request',
  'concepts/overview',
  'concepts/tasks-and-states',
  'concepts/history-and-decisions',
  'concepts/saving-and-recovery',
  'concepts/notifications',
  'concepts/server-and-ui',
  'concepts/agents',
  'concepts/remote-access',
  'concepts/security',
  'reference/files',
  'reference/web-api',
  'reference/errors',
  'reference/agent-output',
  'reference/remote-routes',
  'reference/code-map',
  'troubleshooting',
  'docs-and-images',
] as const;

export type GuideFile = (typeof guideFiles)[number];
export type DevFile = (typeof devFiles)[number];
export type PageFile = GuideFile | 'home';

export function pagePath(lang: Lang, file: PageFile): string {
  const prefix = lang === 'ja' ? 'ja/' : '';
  if (file === 'home') return prefix;
  return file === 'index' ? `${prefix}guide/` : `${prefix}guide/${file}`;
}

export function devPagePath(lang: Lang, file: DevFile): string {
  const prefix = lang === 'ja' ? 'ja/' : '';
  return file === 'index' ? `${prefix}dev/` : `${prefix}dev/${file}`;
}

// Every page of the site in both languages: the home page, the fifteen guide pages, and the twenty-one
// developer pages (74).
export const allPages: { lang: Lang; file: string; path: string }[] = (['en', 'ja'] as Lang[]).flatMap((lang) => [
  ...(['home', ...guideFiles] as PageFile[]).map((file) => ({ lang, file, path: pagePath(lang, file) })),
  ...devFiles.map((file) => ({ lang, file: `dev/${file}`, path: devPagePath(lang, file) })),
]);

// Pages that must render a Mermaid diagram.
export const mermaidFiles: PageFile[] = ['index', 'use/decisions', 'automation/agents'];

// The nine guide screenshots covered by the page-level language checks (eighteen files with the Japanese set)
// and the guide page that shows each one.
export const guideScreenshots: Record<string, GuideFile> = {
  'card-detail': 'use/board',
  archive: 'use/board',
  settings: 'use/board',
  'board-dark': 'use/board',
  question: 'use/decisions',
  editor: 'use/editing',
  'task-request': 'use/editing',
  docs: 'use/docs',
  'docs-conflict': 'use/docs',
};

export function screenshotFile(name: string, lang: Lang): string {
  return lang === 'ja' ? `${name}.ja.png` : `${name}.png`;
}

// Vite bundles an image as /assets/<name>[.ja].<hash>.png; match exactly one language's file.
export function assetPattern(name: string, lang: Lang): RegExp {
  return new RegExp(`/assets/${name}\\.${lang === 'ja' ? 'ja\\.' : ''}[\\w-]+\\.png$`);
}

export function readRepoFile(...segments: string[]): string {
  return fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');
}
