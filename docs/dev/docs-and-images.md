# Documentation and images

The documentation site lives in `docs/`. This page explains how to preview and build it, and how to regenerate the screenshots and demo videos.

## Documentation site

The documentation site lives in `docs/` and is built with VitePress. It has the user guide (`docs/guide/`) and this developer chapter (`docs/dev/`). English is the source language; keep the Japanese pages in `docs/ja/` in step with every English change. It is published to GitHub Pages from `main` by `.github/workflows/docs.yml`; pull requests that change `docs/**` only build it.

```sh
pnpm --dir docs install
pnpm --dir docs dev --port <port>       # live preview
pnpm --dir docs build                   # also checks for dead links
pnpm --dir docs preview --port <port>   # serve the built site
```

Run `pnpm --dir docs build` before committing any change under `docs/`. Links to repository files outside `docs/` use absolute GitHub URLs.

The home page has no Markdown body. Its copy lives in the `landing` frontmatter of `docs/index.md` and `docs/ja/index.md`, and `docs/.vitepress/theme/LandingPage.vue` lays it out, picks the screenshots for the language, and swaps the board image for its dark version. Edit the copy in both files and keep their keys the same. The build's dead-link check does not see links in frontmatter, so the site tests open every link on the home page instead. Its colors are the `--lp-*` variables in `custom.css`, which follow the app's lane and pending colors.

Keep diagrams focused on one flow. Flowcharts and sequence diagrams retain their label size; diagrams wider than the article scroll within their frame. Use a left-to-right flow for system diagrams, and split large diagrams by purpose. The site tests check label size and catch unparsed bold markers in rendered prose. Tables keep a readable minimum column width and scroll horizontally within the article; prose inside cells can still wrap.

Regenerate the guide screenshots and the demo videos with the scripts below. Both need the web UI and CLI [built](./getting-started/setup.md#build) first, and the Playwright browser from [Verification](./getting-started/pull-request.md#verification).

```sh
node e2e/scripts/docs-screenshots.mjs   # docs/images/guide/*.png (18 images, English and Japanese)
node e2e/scripts/demo-video.mjs         # docs/public/videos/ (also needs ffmpeg)
```

Both scripts use disposable data in a temporary `AGBOARD_HOME` and their own loopback ports, so your saved board and port 7420 are untouched. Review the generated images and videos before committing them.

## Preview published release metadata

The version in the site header and the release notes pages come from the published GitHub Releases, not from the repository. `node scripts/release/docs-release.mjs` writes them before the build:

```sh
node scripts/release/docs-release.mjs --github --repo FooQoo/agent-board   # the published site
node scripts/release/docs-release.mjs --fixture                              # local preview of a published state
node scripts/release/docs-release.mjs --none                                 # the state before any release (default)
pnpm --dir docs build
```

- It counts only releases with `draft=false`, `prerelease=false`, and a `vMAJOR.MINOR.PATCH` tag, and takes the newest by version. The version in `Cargo.toml` is never used. Each release body needs an `## English` and a `## 日本語` section with the four headings (`### Changes`, `### Fixes`, `### Breaking changes`, `### Required update steps`, and the Japanese equivalents); anything else stops the script.
- It writes `docs/.vitepress/release.json` (ignored by Git), which the header reads, and `docs/releases.md` and `docs/ja/releases.md`. The committed pages show the "not yet published" state. `--fixture` renders the review copies in `releases/` with a visible warning; do not commit its output.
- The Pages workflow runs the script with `--github` before the build, on `main` pushes, on `release` events (published, edited, deleted), and by hand. If the API call fails or a release is invalid, the build stops and the published site stays as it is. Pull requests build offline with the committed state. A release published with the workflow's own token may not start the workflow; run it by hand.
- `releases/vX.Y.Z.md` is the review copy of the release notes. The GitHub Release body is the source of truth once it is published.
- To check the published look, run the fixture, build, and `pnpm --dir docs preview --port <port>`, then restore the committed pages with `--none`.

## UI stories and coverage

Use Storybook to isolate a component state or compose a full page with the same UI parts the application uses. Keep the Story, focused test, dedicated stylesheet, and coverage entry with the source. When a component or page changes, update its Story and visible-state entry, then review the rendered page at the locale, theme, and viewport it represents. The Storybook page in [Set up and run](./getting-started/setup.md#storybook) describes the current automated coverage limits.

## README screenshots

After [building the web UI and CLI](./getting-started/setup.md#build), regenerate the README images:

```sh
pnpm --dir e2e install --frozen-lockfile
pnpm --dir e2e exec playwright install chromium
node e2e/scripts/readme-screenshots.mjs
```

The script creates disposable projects in temporary `AGBOARD_HOME` directories, starts its own servers on available loopback ports, and captures the desktop board, the epic progress panel, and the mobile drawer in English and Japanese. It never uses your saved board or port 7420. The browser renders the built UI against the real API; images are not mockups. It checks the four detail tabs, the task editor's folded conditions panel, and browser errors, and removes its temporary data afterwards.

Review all six images in `docs/images/` before committing them, and keep the sample text free of personal data. Screenshots do not replace the regression suite or phone keyboard checks. The guide images in `docs/images/guide/` (18 files) come from the separate script above; review them too when you regenerate them.
