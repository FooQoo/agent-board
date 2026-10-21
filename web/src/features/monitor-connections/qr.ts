import qrcode from 'qrcode-generator';

/** The QR code of a URL as an SVG data URL: black modules, no quiet zone (the frame is white). */
export function qrDataUrl(text: string): string {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  const svg = code.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
