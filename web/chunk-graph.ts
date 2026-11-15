import type { Plugin } from 'vite';

/** Where the board build leaves its chunk graph, relative to `web/`. */
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
 * (relative to `web/`), so the build contract can check which modules a chunk holds;
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
