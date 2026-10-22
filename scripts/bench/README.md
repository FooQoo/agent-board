# Benchmark: PC board and phone monitor

These scripts measure transfer size, request counts by route, first display time, the cost of opening a heavy card, DOM size, JavaScript heap use, long tasks, and the transfer after a status change. They record the numbers for comparison; they do not pass or fail anything by a threshold.

- `gen-fixture.mjs` writes a large data area with a fixed seed.
- `measure.mjs` starts the built `agboard` binary on that data, drives it with Playwright, and writes `pc.json` and `monitor.json`.
- `baseline/` holds the results measured on commit `1a9b2d0`.

## Prerequisites

Install these once in the repository:

```sh
pnpm --dir web install
pnpm --dir e2e install --frozen-lockfile
pnpm --dir e2e exec playwright install chromium
```

Build the web UI and the binary. The binary embeds the web UI, so build the UI first:

```sh
pnpm --dir web build
cargo build
```

The monitor measurement also builds the `monitor_phone_serve` test target with `cargo test --no-run`, which the phone entrance in `e2e/helpers/` needs.

## Reproduce

One command generates the fixture, runs both targets three times each, and writes the results:

```sh
TZ=UTC node scripts/bench/measure.mjs
```

The defaults are `--bin target/debug/agboard`, `--port 9210`, `--runs 3`, `--target both`, and `--out-dir scripts/bench/results`. Each run starts from a fresh copy of the fixture in a temporary directory, which is removed afterwards.

Options:

| Option | Meaning |
| --- | --- |
| `--bin <path>` | The `agboard` binary to measure. |
| `--port <n>` | Loopback port of the PC server. Must be within 9210 to 9219. |
| `--runs <n>` | Runs per target. The results keep every run, the median, and the range. |
| `--target pc\|monitor\|both` | Which target to measure. |
| `--fixture <dir>` | A fixture made by `gen-fixture.mjs`. When omitted, one is generated into a temporary directory. |
| `--seed <n>` | Seed for a generated fixture. Default `20261022`. |
| `--commit <sha>` | The commit recorded in the results. Default: the short `HEAD`. |
| `--out-dir <dir>` | Where `pc.json` and `monitor.json` are written. |

To generate the fixture alone, and check that two runs with the same seed match:

```sh
TZ=UTC node scripts/bench/gen-fixture.mjs --out <empty-dir>
```

The command prints the file count, the byte total, and a SHA-256 digest over every file path and content. Two runs with the same seed print the same digest. The CLI writes `shared/projects/<id>/.internal/write.lock` when it reads a project, so compare digests of freshly generated fixtures, not of a directory that has been read.

## The fixture

One project, `Bench`, with the following data:

- 300 cards. The 50 cards whose IDs are multiples of six have 100 history entries each.
- 10 epics, `BENCH-01` to `BENCH-10`. Epics 1 and 2 have a 50,000-character document.
- Cards 6, 12, and 18 have a 50,000-character body with GFM tables, nested lists, code fences, 10 image references each (30 in total), and 7, 7, and 6 Mermaid diagrams (20 in total). They are called heavy cards in the scripts.
- Each image is a 1 x 1 PNG stored as an attachment.

Before measuring, `measure.mjs` reads a copy of the fixture with the CLI and stops if there are not 300 tasks, 10 epics, no file problems, and a 50,000-character body.

## What is measured

Each target runs the same steps:

1. Open the board or the monitor and wait for card `#1` (`Bench task 001`) to appear. The time to appear is `firstVisibleMs`.
2. Count the requests and bytes until the page is quiet. Requests are grouped by route in `routes.load`, and by category (document, api, static, stream) in the metrics.
3. Open heavy card `#6`, wait for its body, and count the requests and bytes (`heavy.*`, `heavyOpenMs`). Then record the DOM node count and the JavaScript heap used (`Performance.getMetrics`, `JSHeapUsedSize`, without a forced garbage collection).
4. Move card `#1` from Todo to Doing with the CLI, while the page stays open. Wait for the page to request the change (`statusDetectedMs`) and for the requests to stop. Record the requests and bytes (`status.*`, `statusMs`).

Long tasks come from a `PerformanceObserver` on `longtask`, installed before the page loads. The count and the total duration cover the whole session.

Streams (`/api/events`) are counted as requests. Their bytes are not counted, because a stream does not finish while the page is open.

## Notes on the monitor

The monitor is reached through the ngrok entrance in production. The benchmark uses the phone entrance from `e2e/helpers/phone-entrance.mjs` instead, which starts the `monitor_phone_serve` backend with a fake tunnel and a proxy that stands in for the Edge. For the monitor, `--bin` only supplies the CLI used for the status change. The backend is the test target built from the same checkout. The phone entrance and its backend bind OS-assigned loopback ports, so the monitor runs fall outside 9210 to 9219. The PC server uses `--port`.

## Results

`baseline/pc.json` and `baseline/monitor.json` hold the results for commit `1a9b2d0`, with the platform, Chromium version, Playwright version, and fixture digest. Byte and request counts were the same in all three runs for every item. Timings varied within the ranges stored in each file.
