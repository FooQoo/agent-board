import fs from 'node:fs'
import path from 'node:path'

// Guide pages that moved when the guide was regrouped around delegating work. The old URLs were
// published (README, the plugin README, external links), so each one keeps a small page that
// forwards to the new one. Paths are relative to the site root, without a leading slash.
const moved: [string, string][] = [
  ['guide/concepts', 'guide/work-model'],
  ['guide/automation/agents', 'guide/delegate/agents'],
  ['guide/use/decisions', 'guide/delegate/decisions'],
  ['guide/use/board', 'guide/watch/board'],
  ['guide/operations/mobile-monitor', 'guide/watch/mobile-monitor'],
  ['guide/use/epics', 'guide/watch/epics'],
  ['guide/use/editing', 'guide/watch/editing'],
  ['guide/use/docs', 'guide/watch/docs'],
  ['guide/automation/cli', 'guide/reference/cli'],
  ['guide/automation/file-format', 'guide/reference/file-format'],
]

// Old path -> new path for English and Japanese (20 entries).
export const redirects: Record<string, string> = Object.fromEntries(
  moved.flatMap(([from, to]) => [
    [from, to],
    [`ja/${from}`, `ja/${to}`],
  ]),
)

function redirectPage(lang: string, title: string, target: string): string {
  const text =
    lang === 'ja'
      ? `このページは <a href="${target}">${title}</a> に移動しました。`
      : `This page moved to <a href="${target}">${title}</a>.`
  return `<!DOCTYPE html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <meta name="robots" content="noindex">
    <link rel="canonical" href="${target}">
    <meta http-equiv="refresh" content="0; url=${target}">
  </head>
  <body>
    <p>${text}</p>
  </body>
</html>
`
}

// Writes one HTML file at each old path's output location, which is where cleanUrls puts a page.
// Throws when a target page was not built, so a typo in the map stops the build. The pages are
// written after the search index is built, so they are not searchable, and the site has no sitemap.
export function writeRedirects(outDir: string, base: string, titleOf: (path: string) => string): void {
  for (const [from, to] of Object.entries(redirects)) {
    if (!fs.existsSync(path.join(outDir, `${to}.html`))) {
      throw new Error(`redirect target ${to} was not built (from ${from})`)
    }
    const file = path.join(outDir, `${from}.html`)
    if (fs.existsSync(file)) throw new Error(`redirect source ${from} is still a page`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const lang = from.startsWith('ja/') ? 'ja' : 'en'
    fs.writeFileSync(file, redirectPage(lang, titleOf(to), `${base}${to}`))
  }
}
