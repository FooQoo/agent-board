import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export type Lang = 'en' | 'ja';

// Sidebar order of the guide, from the site's information architecture.
export const guideFiles = [
  'index',
  'getting-started',
  'board',
  'decisions',
  'epics',
  'editing',
  'agents',
  'cli',
  'mobile-monitor',
  'data',
] as const;

export type GuideFile = (typeof guideFiles)[number];
export type PageFile = GuideFile | 'home';

export function pagePath(lang: Lang, file: PageFile): string {
  const prefix = lang === 'ja' ? 'ja/' : '';
  if (file === 'home') return prefix;
  return file === 'index' ? `${prefix}guide/` : `${prefix}guide/${file}`;
}

// Every page of the site: both home pages and the ten guide pages in both languages (22).
export const allPages: { lang: Lang; file: PageFile; path: string }[] = (['en', 'ja'] as Lang[]).flatMap(
  (lang) =>
    (['home', ...guideFiles] as PageFile[]).map((file) => ({ lang, file, path: pagePath(lang, file) })),
);

// Pages that must render a Mermaid diagram.
export const mermaidFiles: PageFile[] = ['home', 'index', 'decisions', 'agents'];

// The six new guide screenshots (docs/images/guide, twelve files with the Japanese set)
// and the guide page that shows each one.
export const guideScreenshots: Record<string, GuideFile> = {
  'card-detail': 'board',
  archive: 'board',
  settings: 'board',
  'board-dark': 'board',
  question: 'decisions',
  editor: 'editing',
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
