# Editor measurement: Crepe feature set and chunk sizes

This is the record of a throwaway spike. The spike code was deleted before the
commit; only these measurements remain.

## Method

- Packages: `@milkdown/crepe` 7.22.2 and `mermaid` 12.1.0, the same pinned
  versions as `web/package.json`. The spike imported Crepe through its subpath
  exports and added no dependency of its own. The browser driver
  (`playwright-core` 1.64 with the Chromium headless shell cached for it) lived
  outside the repository.
- Bundling used the repository's `web/vite.config.ts` production options, so the
  chunk names are `app-[name]-[hash].js`. A spike entry loaded one variant at a
  time through a dynamic `import()`.
- Selected feature set: CodeMirror, ListItem, ImageBlock, Cursor, Placeholder,
  LinkTooltip, Toolbar, Table. Not used: BlockEdit, Latex, TopBar, AI.
  Comparison: Crepe's default feature set (`new Crepe()`).
- Input: `sample-input.md`. The editor was created with it as the default value,
  nothing was touched, and `getMarkdown()` was read before the editor was
  destroyed.
- Sizes: raw bytes and gzip bytes at zlib level 9. Vite's own build report uses
  a different gzip level, so its numbers differ slightly (for example, 347.20 kB
  there versus 342,826 bytes here).
- Environment: macOS arm64, Node 24.19.0, pnpm 12.5.1.

## Rewrites on load (`sample-diff.diff`, `probes.json`)

Output is from the selected feature set. Opening the body and changing nothing
still rewrote the following:

| Input | Output | Kind |
|---|---|---|
| `* 2 * 3 = 6、a<b、[角括弧]` | `* 2 \* 3 = 6、a\<b、\[角括弧]` | characters escaped |
| `+ item` after a `*` list | `- item` | bullet changed (adjacent lists alternate markers); on its own `+ item` becomes `* item` |
| nested item indented with 4 spaces | indented with 2 spaces | indentation changed |
| `1) one` | `1. one` | ordered-list marker changed |
| `- [ ] AC-1. text` | `* [ ] AC-1. text` | task-list bullet changed from `-` to `*` |
| `\|:---\|---:\|` with compact cells | `\| :- \| -: \|` with padded cells | table reflowed and alignment markers re-padded |
| `text  ` (two trailing spaces) | `text\` | hard-break syntax changed |

Unchanged: `* item` lists, `\#` escapes, `*emphasis*`, `__strong__`,
`~~struck~~`, inline code, `<https://…>` autolinks, `[link](…)`, block quotes,
`***` rules, and the mermaid, TypeScript and plain code fences (the fence content
is byte-identical).

### Finding 1: image references are removed (blocks AC-7 as written)

The image reference `![図: …](assets/0123456789abcdef.png)` is removed from the
output. Repeated probes (see `probes.json`):

- Image on its own line, without a title: removed. The parser logs
  `RangeError: Expected value of type string for attribute caption on type image-block, got null`.
- Same without the ImageBlock feature: replaced by `<br />`. The error is for
  attribute `title` on type `image`.
- Image inside a sentence, without a title: removed from the paragraph.
- Crepe's default feature set: the same removal as the selected set.
- Image with a title, `![図: a](assets/x.png "t")`: kept, but the alt text is
  replaced with `1.00`.

Removing ImageBlock does not prevent the loss, so this is not a feature-selection
problem. AC-7 requires that unedited notation stays unchanged, so Crepe 7.22.2
does not meet it for image references as written. This needs a decision before
the editor (UoW 5) is built.

## Chunk sizes (`chunk-sizes.tsv`)

| Variant | Chunks emitted | Fetched on first use (raw / gzip) |
|---|---|---|
| Selected feature set | 1 editor chunk, `app-spec-editor-096TMnIA.js` | 1,088,343 / 342,826 |
| Crepe default features | 120 files | editor chunk 1,155,987 / 357,299 and one 314,925 / 100,671 chunk; total 1,470,912 / 457,970 |
| mermaid 12.1.0, one flowchart | 97 files | 30 chunks, 2,230,331 / 649,249, including ELK layout 1,462,948 / 448,646 |

The TSV lists the entry `app.js` of the spike build as a separate line, so the
TSV totals include it (2,995 to 3,154 bytes). The table above excludes it.

Feature selection effect: for the editor code fetched on first use, the selected
set is 382,569 bytes raw smaller than the default (26%), and 115,144 bytes
smaller gzipped (25%).

Observed on a flowchart render: mermaid 12.1.0 also fetched the ELK layout
chunk, which is 1,462,948 bytes raw and about 66% of the 2,230,331 bytes fetched.
Why ELK is fetched for a plain flowchart was not investigated.

## Application build

`pnpm --dir web build` at this commit emits no chunk. Nothing in the application
imports the editor or Mermaid lazily yet; that comes with UoW 5. The `app.js`
size is unchanged from before this change: 1,266,232 bytes (412.78 kB gzip).

## Open items

1. Finding 1 (image references) needs a decision from the coordinator before
   the editor is built.
2. Splitting is shown only in the spike build; the application build produces
   no chunk until UoW 5 adds the lazy imports.
3. What makes up the largest part of the 1.09 MB editor chunk was not analysed.

## Files

- `sample-input.md`: the input body.
- `sample-output-selected.md`: Crepe's output, selected feature set.
- `sample-diff.diff`: unified diff of the two.
- `probes.json`: targeted probes for list markers, tables, hard breaks, escapes
  and images, with console errors.
- `chunk-sizes.tsv`: chunk sizes and the first-use fetch set for each variant.
