// Writes `<name>.gz` beside every script and stylesheet the server embeds. The server sends the
// compressed bytes to browsers that accept gzip, and build.rs embeds only those.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync, constants } from 'node:zlib';

const dist = new URL('../dist/', import.meta.url);
const EMBEDDED = /^(app|monitor|chunk)-[^/]+\.(js|css)$/;

for (const folder of ['assets', 'monitor']) {
  const dir = new URL(`${folder}/`, dist);
  for (const name of await readdir(dir)) {
    if (!EMBEDDED.test(name)) continue;
    const bytes = await readFile(new URL(name, dir));
    // Fixed settings keep the output the same for the same input, so a chunk both builds
    // contain compresses to identical bytes.
    const gzip = gzipSync(bytes, { level: constants.Z_BEST_COMPRESSION });
    await writeFile(new URL(`${name}.gz`, dir), gzip);
  }
}
