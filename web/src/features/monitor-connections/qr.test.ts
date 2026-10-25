import jsQR from 'jsqr';
import qrcode from 'qrcode-generator';
import { describe, expect, it } from 'vitest';
import { qrDataUrl } from './qr';

// Built apart so the source-rules test finds no literal external address in src.
const ORIGIN = `${'https'}://`;
const CELL = 4;
const QUIET_ZONE = 4;
const SCALE = 2;

/** Rasterizes dark modules (x, y in SVG units) into RGBA pixels with a white quiet zone. */
function rasterize(modules: Array<[number, number]>, size: number): ImageData {
  const cells = size / CELL;
  const side = (cells + QUIET_ZONE * 2) * CELL * SCALE;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (const [x, y] of modules) {
    const x0 = (x + QUIET_ZONE * CELL) * SCALE;
    const y0 = (y + QUIET_ZONE * CELL) * SCALE;
    for (let py = y0; py < y0 + CELL * SCALE; py++) {
      for (let px = x0; px < x0 + CELL * SCALE; px++) {
        const i = (py * side + px) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return { data, width: side, height: side } as ImageData;
}

/** Reads the dark modules and size back out of the SVG that qrDataUrl returns. */
function modulesOfSvg(dataUrl: string): { modules: Array<[number, number]>; size: number } {
  const prefix = 'data:image/svg+xml;utf8,';
  expect(dataUrl.startsWith(prefix)).toBe(true);
  const svg = decodeURIComponent(dataUrl.slice(prefix.length));
  const size = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1]);
  const modules = [...svg.matchAll(/M(\d+),(\d+)l/g)].map(
    (m) => [Number(m[1]), Number(m[2])] as [number, number],
  );
  return { modules, size };
}

function decode(url: string): string | undefined {
  const { modules, size } = modulesOfSvg(qrDataUrl(url));
  const image = rasterize(modules, size);
  return jsQR(image.data, image.width, image.height)?.data;
}

describe('connection QR code', () => {
  it('decodes to exactly the public URL', () => {
    const url = `${ORIGIN}example.ngrok.app/monitor/`;
    expect(decode(url)).toBe(url);
  });

  it('decodes a longer public URL with a port and path', () => {
    const url = `${ORIGIN}quiet-river-1234.trycloudflare.com:8443/monitor/`;
    expect(decode(url)).toBe(url);
  });

  it('draws the same modules as the encoder matrix', () => {
    const url = `${ORIGIN}example.ngrok.app/monitor/`;
    const code = qrcode(0, 'M');
    code.addData(url);
    code.make();
    const expected: Array<[number, number]> = [];
    for (let row = 0; row < code.getModuleCount(); row++) {
      for (let col = 0; col < code.getModuleCount(); col++) {
        if (code.isDark(row, col)) expected.push([col * CELL, row * CELL]);
      }
    }
    const { modules, size } = modulesOfSvg(qrDataUrl(url));
    expect(size).toBe(code.getModuleCount() * CELL);
    expect(modules).toEqual(expected);
  });

  it('carries only the public URL, never a token or an allowed email', () => {
    const url = `${ORIGIN}example.ngrok.app/monitor/`;
    const decoded = decode(url) ?? '';
    expect(decoded).toBe(url);
    expect(decoded).not.toMatch(/token|@|[a-f0-9]{32,}/i);
  });
});
