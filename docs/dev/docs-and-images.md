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

Keep diagrams focused on one flow. Flowcharts and sequence diagrams retain their label size; diagrams wider than the article scroll within their frame. Use a left-to-right flow for system diagrams, and split large diagrams by purpose. The site tests check label size and catch unparsed bold markers in rendered prose. Tables keep a readable minimum column width and scroll horizontally within the article; prose inside cells can still wrap.

Regenerate the guide screenshots and the demo videos with the scripts below. Both need the web UI and CLI [built](./getting-started/setup.md#build) first, and the Playwright browser from [Verification](./getting-started/pull-request.md#verification).

```sh
node e2e/scripts/docs-screenshots.mjs   # docs/images/guide/*.png (16 images, English and Japanese)
node e2e/scripts/demo-video.mjs         # docs/public/videos/ (also needs ffmpeg)
```

Both scripts use disposable data in a temporary `AGBOARD_HOME` and their own loopback ports, so your saved board and port 7420 are untouched. Review the generated images and videos before committing them.

## README screenshots

After [building the web UI and CLI](./getting-started/setup.md#build), regenerate the README images:

```sh
pnpm --dir e2e install --frozen-lockfile
pnpm --dir e2e exec playwright install chromium
node e2e/scripts/readme-screenshots.mjs
```

The script creates disposable projects in temporary `AGBOARD_HOME` directories, starts its own servers on available loopback ports, and captures the desktop board, the epic progress panel, and the mobile drawer in English and Japanese. It never uses your saved board or port 7420. The browser renders the built UI against the real API; images are not mockups. It checks the four detail tabs, the task editor's folded conditions panel, and browser errors, and removes its temporary data afterwards.

Review all six images in `docs/images/` before committing them, and keep the sample text free of personal data. Screenshots do not replace the regression suite or phone keyboard checks. The guide images in `docs/images/guide/` (14 files) come from the separate script above; review them too when you regenerate them.
