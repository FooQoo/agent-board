// Builds the opaque Home Screen icons (white background, logo centered) from web/public/logo.png.
// iOS fills a transparent icon with black, so these files carry their own white background.
// Run: node scripts/dev/generate-home-icons.mjs   (needs the Playwright browser from `pnpm --dir web install`)
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const { chromium } = createRequire(join(root, 'web', 'package.json'))('playwright')

const SIZES = [180, 192, 512]
// logo.png already has about 18% padding on each side, so at this ratio the glyph fills
// roughly 61% of the icon.
const LOGO_RATIO = 0.96
const logo = readFileSync(join(root, 'web/public/logo.png')).toString('base64')

const browser = await chromium.launch()
const page = await browser.newPage()
const rendered = await page.evaluate(
  async ({ logo, sizes, ratio }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${logo}`
    await image.decode()
    return sizes.map((size) => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, size, size)
      ctx.imageSmoothingQuality = 'high'
      const side = size * ratio
      ctx.drawImage(image, (size - side) / 2, (size - side) / 2, side, side)
      return canvas.toDataURL('image/png').split(',')[1]
    })
  },
  { logo, sizes: SIZES, ratio: LOGO_RATIO },
)
await browser.close()
SIZES.forEach((size, i) => {
  writeFileSync(join(root, `web/public/home-icon-${size}.png`), Buffer.from(rendered[i], 'base64'))
})
