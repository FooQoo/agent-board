import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Plugin } from 'vite';

/** Where the board build leaves its chunk graph for the monitor build, relative to `web/`. */
export const CHUNK_GRAPH = 'dist/chunk-graph.json';

export interface ChunkGraph {
  /** Every chunk by its output file name (`assets/...`). */
  chunks: Record<
    string,
    { imports: string[]; dynamicImports: string[]; sources: string[]; packages: string[] }
  >;
}

/**
 * Writes the board build's chunk graph. `sources` lists the modules from `web/src/` in each chunk
 * (relative to `web/`), so the monitor build can check that a chunk it reuses holds no board code;
 * `packages` names the npm packages each chunk bundles.
 */
export function chunkGraph(): Plugin {
  return {
    name: 'agboard-chunk-graph',
    apply: 'build',
    generateBundle(_options, bundle) {
      const graph: ChunkGraph = { chunks: {} };
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        graph.chunks[item.fileName] = {
          imports: [...item.imports].sort(),
          dynamicImports: [...item.dynamicImports].sort(),
          sources: Object.keys(item.modules)
            .map((id) => id.match(/\/web\/(src\/.*)$/)?.[1])
            .filter((id): id is string => id !== undefined)
            .sort(),
          packages: [
            ...new Set(
              Object.keys(item.modules)
                .map((id) => id.match(/node_modules\/(?!\.pnpm\/)((?:@[^/]+\/)?[^/]+)/)?.[1])
                .filter((name): name is string => name !== undefined),
            ),
          ].sort(),
        };
      }
      this.emitFile({
        type: 'asset',
        fileName: 'chunk-graph.json',
        source: `${JSON.stringify(graph, null, 2)}\n`,
      });
    },
  };
}

/**
 * Makes the monitor build reuse the board build's diagram renderer instead of bundling its own
 * copy: `import('mermaid')` loads the board's `mermaid.core` chunk from the monitor's asset folder,
 * and that chunk with everything it imports is copied there unchanged. Identical bytes are embedded
 * in the executable once. The board build must run first.
 */
export function sharedMermaid(webDir: string, base: string): Plugin {
  let graph: ChunkGraph | null = null;
  let core = '';
  return {
    name: 'agboard-shared-mermaid',
    enforce: 'pre',
    apply: 'build',
    buildStart() {
      const path = join(webDir, CHUNK_GRAPH);
      if (!existsSync(path)) this.error(`${CHUNK_GRAPH} is missing. Build the board UI first.`);
      graph = JSON.parse(readFileSync(path, 'utf8')) as ChunkGraph;
      const found = Object.keys(graph.chunks).filter((name) =>
        /^assets\/chunk-mermaid\.core-[\w-]+\.js$/.test(name),
      );
      if (found.length !== 1) this.error('The board build must have one mermaid.core chunk.');
      core = found[0] as string;
    },
    resolveId(id) {
      if (id !== 'mermaid') return null;
      return { id: `${base}${basename(core)}`, external: true };
    },
    generateBundle() {
      if (!graph) return;
      for (const name of chunkClosure(graph, core)) {
        const chunk = graph.chunks[name];
        if (!/^assets\/chunk-[^/]+\.js$/.test(name) || (chunk?.sources.length ?? 0) > 0)
          this.error(`The diagram renderer reaches board code: ${name}`);
        this.emitFile({
          type: 'asset',
          fileName: basename(name),
          source: readFileSync(join(webDir, 'dist', name)),
        });
      }
    },
  };
}

/** `start` and every chunk it imports, statically or on demand, sorted. */
export function chunkClosure(graph: ChunkGraph, start: string): string[] {
  const seen = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const name = pending.pop() as string;
    if (seen.has(name)) continue;
    const chunk = graph.chunks[name];
    if (!chunk) throw new Error(`The board build has no chunk ${name}.`);
    seen.add(name);
    pending.push(...chunk.imports, ...chunk.dynamicImports);
  }
  return [...seen].sort();
}
