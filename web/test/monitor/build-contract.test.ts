import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dist = resolve('dist');
const read = (relative: string) => readFileSync(join(dist, relative), 'utf8');

describe('isolated monitor build', () => {
  it('emits fixed access and monitor entries without a token or PC entry', () => {
    const access = read('access/index.html');
    const monitor = read('monitor/index.html');
    expect(access).toContain('/assets/access/entry.js');
    expect(monitor).toContain('/assets/monitor/monitor.js');
    expect(monitor).toContain('/assets/monitor/monitor.css');
    expect(`${access}\n${monitor}`).not.toContain('agboard-token');
    expect(`${access}\n${monitor}`).not.toContain('/assets/app.js');
  });

  it('keeps dedicated asset manifests and only single-level viewer chunks', () => {
    for (const name of ['access/entry.js', 'monitor/monitor.js', 'monitor/monitor.css']) {
      expect(existsSync(join(dist, name))).toBe(true);
    }
    const monitorFiles = readdirSync(join(dist, 'monitor'));
    expect(monitorFiles).toContain('manifest.json');
    expect(monitorFiles.filter((name) => name.endsWith('.js'))).toContain('monitor.js');
    expect(read('monitor/manifest.json')).not.toContain('assets/app.js');
    expect(
      monitorFiles
        .filter((name) => name.startsWith('viewer-'))
        .every((name) => !name.includes('/')),
    ).toBe(true);
    const accessAssets = JSON.parse(read('access/manifest.json')).assets.map(
      (asset: { name: string }) => asset.name,
    );
    const monitorAssets = JSON.parse(read('monitor/manifest.json')).assets.map(
      (asset: { name: string }) => asset.name,
    );
    expect(accessAssets).toEqual(['index.html', 'entry.js']);
    expect(monitorAssets).toEqual([
      'index.html',
      'monitor.js',
      'monitor.css',
      ...monitorFiles.filter((name) => name.startsWith('viewer-')).sort(),
    ]);
  });

  it('keeps the monitor dependency graph independent of PC app and editor modules', () => {
    const graph = read('monitor/dependency-graph.json');
    expect(graph).not.toMatch(/src\/App|components\/editor|src\/api\//);
    expect(graph).toContain('src/monitor-main.tsx');
  });
});
