import { expect, test, type Page } from '@playwright/test';
import {
  allPages,
  assetPattern,
  devFiles,
  devPagePath,
  guideFiles,
  guideScreenshots,
  mermaidFiles,
  pagePath,
  screenshotFile,
  type Lang,
} from './site';

const langs: Lang[] = ['en', 'ja'];
const repoUrl = 'https://github.com/FooQoo/agent-board';

// Markdown syntax must not leak into rendered prose. Code samples may intentionally contain it.
async function unparsedStrongMarkers(page: Page): Promise<string[]> {
  return page.locator('.vp-doc').evaluateAll((roots) => {
    const markers: string[] = [];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement?.closest('pre, code, script, style')) continue;
        if (node.textContent?.includes('**')) markers.push(node.textContent);
      }
    }
    return markers;
  });
}

// A diagram that fits the page can still be unreadable when its labels are scaled down.
async function expectReadableDiagrams(page: Page) {
  for (const diagram of await page.locator('.mermaid').all()) {
    const svg = diagram.locator('svg');
    await expect(svg).toBeVisible();
    const readLabels = () => svg.evaluate((element: SVGSVGElement) => {
      const scale = element.getBoundingClientRect().width / element.viewBox.baseVal.width;
      return Array.from(element.querySelectorAll('.nodeLabel, .edgeLabel, text'))
        .filter((label) => label.textContent?.trim())
        .map((label) => ({
          text: label.textContent,
          size: parseFloat(getComputedStyle(label).fontSize) * scale,
        }));
    });
    // Mermaid replaces its initial SVG asynchronously, including during theme changes.
    await expect.poll(async () => {
      const labels = await readLabels();
      return labels.length > 0 && labels.every((label) => Number.isFinite(label.size) && label.size >= 12);
    }, { message: 'diagram labels render at a readable size' }).toBe(true);
  }
}

// Scroll every rendered image into view (so lazy images load) and report the ones that failed
// to decode. Images that are not rendered (the logo of the other color scheme) are skipped.
async function brokenImages(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const broken: string[] = [];
    for (const img of Array.from(document.images)) {
      if (img.getClientRects().length === 0) continue;
      img.scrollIntoView({ block: 'center' });
      if (!img.complete) {
        await new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        });
      }
      if (img.naturalWidth === 0) broken.push(img.getAttribute('src') ?? '(no src)');
    }
    return broken;
  });
}

// AC-2: hero, feature cards, buttons, board image
for (const lang of langs) {
  test(`home page (${lang}) shows the hero, three feature tasks, and two buttons`, async ({ page }) => {
    const response = await page.goto(pagePath(lang, 'home'));
    expect(response?.status()).toBe(200);

    const hero = page.locator('.VPHero');
    await expect(hero.locator('.name')).toHaveText('Agent Board');
    await expect(hero.locator('.tagline')).toHaveText(
      lang === 'en'
        ? 'A shared work board where users and AI agents keep work moving together.'
        : 'ユーザーとAIが一緒に作業を進める共有ボード。',
    );
    // The logo is a light/dark pair; exactly one is visible.
    const logos = hero.locator('.image img');
    await expect(logos).toHaveCount(2);
    await expect(hero.locator('.image img:visible')).toHaveCount(1);
    for (const logo of await logos.all()) {
      await expect(logo).toHaveAttribute('alt', lang === 'en' ? 'Agent Board logo' : 'Agent Boardのロゴ');
    }

    const features = page.locator('.VPFeature');
    await expect(features).toHaveCount(3);
    const icons = ['kanban', 'list-ordered', 'file-text'];
    for (let i = 0; i < 3; i++) {
      const feature = features.nth(i);
      await expect(feature.locator('.title')).not.toBeEmpty();
      await expect(feature.locator('.details')).not.toBeEmpty();
      await expect(feature.locator('img')).toHaveAttribute('src', `/agent-board/icons/${icons[i]}.svg`);
    }

    const start = hero.getByRole('link', { name: lang === 'en' ? 'Get started' : 'はじめる' });
    await expect(start).toHaveAttribute(
      'href',
      lang === 'en' ? '/agent-board/guide/getting-started' : '/agent-board/ja/guide/getting-started',
    );
    await expect(hero.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', repoUrl);

    const boardSrc = (await docImageSources(page)).find((src) => assetPattern('board', lang).test(src));
    expect(boardSrc).toBeTruthy();
    const board = page.locator(`.vp-doc img[src="${boardSrc}"]`);
    await board.scrollIntoViewIfNeeded();
    await expect(board).toHaveClass(/screenshot/);
    expect(await brokenImages(page)).toEqual([]);

    // The start button opens a real page.
    await start.click();
    await expect(page.locator('h1').first()).toBeVisible();
  });
}

// AC-1, AC-3: all guide and developer pages open, have an h1, no placeholder, images load, sidebar matches
for (const { lang, file, path: urlPath } of allPages.filter((p) => p.file !== 'home')) {
  test(`page ${urlPath} renders content and loads its images`, async ({ page }) => {
    const response = await page.goto(urlPath);
    expect(response?.status()).toBe(200);
    expect(await response?.text()).not.toContain('docs-site:placeholder');
    await expect(page.locator('.vp-doc h1')).toHaveCount(1);
    await expect(page.locator('.vp-doc h1')).not.toBeEmpty();
    expect(await brokenImages(page)).toEqual([]);

    expect(await unparsedStrongMarkers(page)).toEqual([]);

    // The current page is highlighted in the sidebar.
    const active = page.locator('.VPSidebarItem.is-active > .item a').first();
    await expect(active).toHaveAttribute('href', `/agent-board/${urlPath}`);
    expect(file).toBeTruthy();
  });
}

test('the sidebar lists the fourteen guide pages in four groups, in the same order in both languages', async ({ page }) => {
  const hrefs: Record<Lang, string[]> = { en: [], ja: [] };
  for (const lang of langs) {
    await page.goto(pagePath(lang, 'index'));
    await expect(page.locator('.VPSidebar .VPSidebarItem.level-0')).toHaveCount(4);
    const links = page.locator('.VPSidebar .VPSidebarItem.level-1 > .item a.link');
    await expect(links).toHaveCount(guideFiles.length);
    hrefs[lang] = await links.evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''));
  }
  expect(hrefs.en).toEqual(guideFiles.map((f) => `/agent-board/${pagePath('en', f)}`));
  expect(hrefs.ja).toEqual(guideFiles.map((f) => `/agent-board/${pagePath('ja', f)}`));
  // Same order: stripping the language prefix gives identical lists.
  expect(hrefs.ja.map((h) => h.replace('/agent-board/ja/', '/agent-board/'))).toEqual(hrefs.en);
});

test('the developer chapter is in the nav and its sidebar lists twenty-one pages in four groups', async ({ page }) => {
  for (const lang of langs) {
    await page.goto(pagePath(lang, 'home'));
    const nav = page.locator('.VPNavBarMenu').getByRole('link', { name: lang === 'en' ? 'Developers' : '開発者向け' });
    await expect(nav).toHaveAttribute('href', `/agent-board/${devPagePath(lang, 'index')}`);
    await page.goto(devPagePath(lang, 'index'));
    await expect(page.locator('.VPSidebar .VPSidebarItem.level-0')).toHaveCount(4);
    const links = page.locator('.VPSidebar .VPSidebarItem.level-1 > .item a.link');
    expect(await links.evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''))).toEqual(
      devFiles.map((f) => `/agent-board/${devPagePath(lang, f)}`),
    );
  }
});

// AC-4: language switch
for (const file of guideFiles) {
  test(`language menu moves between the English and Japanese ${file} page`, async ({ page }) => {
    await page.goto(pagePath('en', file));
    const menu = page.locator('.VPNavBarTranslations');
    await menu.getByRole('button', { name: 'Change language' }).click();
    await menu.getByRole('link', { name: '日本語' }).click();
    await expect(page).toHaveURL(new RegExp(`/agent-board/${pagePath('ja', file).replace('/', '\\/')}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    expect(await brokenImages(page)).toEqual([]);
    for (const src of await docImageSources(page)) expect(src).toMatch(/\.ja\.[\w-]+\.png$/);

    await page.locator('.VPNavBarTranslations').getByRole('button', { name: '言語を変更' }).click();
    await page.locator('.VPNavBarTranslations').getByRole('link', { name: 'English' }).click();
    await expect(page).toHaveURL(new RegExp(`/agent-board/${pagePath('en', file).replace('/', '\\/')}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    for (const src of await docImageSources(page)) expect(src).not.toMatch(/\.ja\./);
  });
}

// Source of every content image on the page, in document order.
async function docImageSources(page: Page): Promise<string[]> {
  return page.locator('.vp-doc img').evaluateAll((els) => els.map((el) => el.getAttribute('src') ?? ''));
}

// AC-4, AC-5: the twelve guide screenshots are shown, in the right language
test('every guide screenshot appears on its page in English and Japanese', async ({ page }) => {
  const seen = new Set<string>();
  for (const lang of langs) {
    for (const [name, file] of Object.entries(guideScreenshots)) {
      await page.goto(pagePath(lang, file));
      const sources = await docImageSources(page);
      const match = sources.filter((src) => assetPattern(name, lang).test(src));
      expect(match, `${lang} ${file} should show ${screenshotFile(name, lang)}`).toHaveLength(1);
      // The other language's file is not used on this page.
      const otherLang: Lang = lang === 'en' ? 'ja' : 'en';
      expect(sources.filter((src) => assetPattern(name, otherLang).test(src))).toHaveLength(0);

      const img = page.locator(`.vp-doc img[src="${match[0]}"]`);
      await img.scrollIntoViewIfNeeded();
      await expect(img).toBeVisible();
      await expect(img).toHaveClass(/screenshot/);
      expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
      seen.add(screenshotFile(name, lang));
    }
  }
  expect(seen.size).toBe(12);
});

// AC-5: the existing board / epic / mobile images are still used
test('board, epic, and mobile screenshots appear on the home and feature pages', async ({ page }) => {
  for (const lang of langs) {
    const targets: [string, string][] = [
      [pagePath(lang, 'home'), 'board'],
      [pagePath(lang, 'home'), 'epic'],
      [pagePath(lang, 'home'), 'mobile'],
      [pagePath(lang, 'index'), 'board'],
      [pagePath(lang, 'use/epics'), 'epic'],
      [pagePath(lang, 'operations/mobile-monitor'), 'mobile'],
    ];
    for (const [url, name] of targets) {
      await page.goto(url);
      const match = (await docImageSources(page)).filter((src) => assetPattern(name, lang).test(src));
      expect(match.length, `${lang} ${url} should show ${name}`).toBeGreaterThan(0);
      const img = page.locator(`.vp-doc img[src="${match[0]}"]`).first();
      await img.scrollIntoViewIfNeeded();
      expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    }
  }
});

// AC-6: Mermaid
for (const lang of langs) {
  for (const file of mermaidFiles) {
    test(`mermaid diagram renders on the ${lang} ${file} page`, async ({ page }) => {
      await page.goto(pagePath(lang, file));
      const diagrams = page.locator('.mermaid');
      await expect(diagrams.first()).toBeVisible();
      for (const diagram of await diagrams.all()) {
        await expect(diagram.locator('svg')).toHaveCount(1);
        await expect(diagram.locator('svg')).toBeVisible();
      }
      // No unrendered source blocks are left behind.
      await expect(page.locator('.language-mermaid')).toHaveCount(0);
    });
  }
}

// AC-7: local search
const searchCases: { lang: Lang; term: string; hrefPart: string }[] = [
  { lang: 'en', term: 'epic', hrefPart: '/agent-board/guide/use/epics' },
  { lang: 'en', term: 'archive', hrefPart: '/agent-board/guide/use/board' },
  { lang: 'ja', term: 'エピック', hrefPart: '/agent-board/ja/guide/use/epics' },
  { lang: 'ja', term: 'アーカイブ', hrefPart: '/agent-board/ja/guide/use/board' },
];
for (const { lang, term, hrefPart } of searchCases) {
  test(`search (${lang}) finds "${term}"`, async ({ page }) => {
    await page.goto(pagePath(lang, 'index'));
    await page.locator('#local-search button').click();
    const input = page.locator('#localsearch-input');
    await expect(input).toBeVisible();
    await input.fill(term);
    const results = page.locator('#localsearch-list a.result');
    await expect(results.first()).toBeVisible();
    const hrefs = await results.evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''));
    expect(hrefs.some((h) => h.startsWith(hrefPart))).toBe(true);
    // Results stay inside the current language.
    if (lang === 'en') expect(hrefs.every((h) => !h.includes('/ja/'))).toBe(true);
    else expect(hrefs.every((h) => h.includes('/ja/'))).toBe(true);
  });
}

// AC-8: dark mode and no horizontal scroll at 375px
test('the appearance switch toggles dark mode and the choice persists', async ({ page }) => {
  await page.goto(pagePath('en', 'home'));
  const html = page.locator('html');
  await expect(html).not.toHaveClass(/dark/);
  await page.getByRole('switch', { name: 'Switch to dark theme' }).click();
  await expect(html).toHaveClass(/dark/);
  await page.reload();
  await expect(html).toHaveClass(/dark/);
  await page.getByRole('switch', { name: 'Switch to light theme' }).click();
  await expect(html).not.toHaveClass(/dark/);

  await page.goto(pagePath('ja', 'home'));
  await page.getByRole('switch', { name: 'ダークモードに切り替え' }).click();
  await expect(html).toHaveClass(/dark/);
});

// Long route names must not squeeze the description column into a few characters.
for (const width of [375, 1440]) {
  for (const lang of langs) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`table columns stay readable and scroll at ${width}px (${lang}, ${scheme})`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript((value) => {
          localStorage.setItem('vitepress-theme-appearance', value);
        }, scheme);
        await page.goto(devPagePath(lang, 'reference/remote-routes'));
        const table = page.locator('.vp-doc table').first();
        await expect(table).toBeVisible();
        const dimensions = await table.evaluate((el) => ({
          viewport: el.clientWidth,
          content: el.scrollWidth,
          description: el.querySelector('tbody td:nth-child(2)')!.getBoundingClientRect().width,
          page: document.documentElement.scrollWidth,
          window: window.innerWidth,
        }));
        expect(dimensions.description).toBeGreaterThanOrEqual(280);
        expect(dimensions.content).toBeGreaterThan(dimensions.viewport);
        expect(dimensions.page).toBeLessThanOrEqual(dimensions.window);
        await table.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
        expect(await table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
      });
    }
  }
}

test.describe('375px viewport', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  for (const scheme of ['light', 'dark'] as const) {
    for (const { path: urlPath } of allPages) {
      test(`${urlPath || 'home'} has no horizontal scroll (${scheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.addInitScript((value) => {
          localStorage.setItem('vitepress-theme-appearance', value);
        }, scheme);
        await page.goto(urlPath);
        await expect(page.locator('html')).toHaveClass(scheme === 'dark' ? /dark/ : /^(?!.*dark)/);
        await expect(page.locator('h1').first()).toBeVisible();
        expect(await brokenImages(page)).toEqual([]);
        await expectReadableDiagrams(page);
        const overflow = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          inner: window.innerWidth,
        }));
        expect(overflow.scroll).toBeLessThanOrEqual(overflow.inner);
      });
    }
  }
});

// AC-8 at desktop width too
for (const { path: urlPath } of allPages) {
  test(`${urlPath || 'home'} has no horizontal scroll at 1440px`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(urlPath);
    await expect(page.locator('h1').first()).toBeVisible();
    await expectReadableDiagrams(page);
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.inner);
  });
}

// AC-11: demo video
for (const lang of langs) {
  for (const file of ['home', 'index'] as const) {
    test(`demo video on the ${lang} ${file} page plays muted in a loop`, async ({ page }) => {
      await page.goto(pagePath(lang, file));
      const video = page.locator('video.demo-video');
      await expect(video).toHaveCount(1);
      const suffix = lang === 'ja' ? '.ja' : '';
      await expect(video).toHaveAttribute('src', `/agent-board/videos/demo${suffix}.mp4`);
      await expect(video).toHaveAttribute('poster', `/agent-board/videos/demo${suffix}.jpg`);
      await expect(video).not.toHaveAttribute('controls', /.*/);
      // Browsers pause muted autoplay videos that are off screen.
      await video.scrollIntoViewIfNeeded();
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
      expect(await video.evaluate((v: HTMLVideoElement) => [v.muted, v.loop, v.autoplay])).toEqual([
        true,
        true,
        true,
      ]);
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0);

      const poster = await page.request.get(`videos/demo${suffix}.jpg`);
      expect(poster.status()).toBe(200);
      expect(poster.headers()['content-type']).toContain('image/jpeg');
      const mp4 = await page.request.get(`videos/demo${suffix}.mp4`);
      expect(mp4.status()).toBe(200);
    });
  }
}

// AC-3, AC-10: removed pages are gone
test('the removed usage and mobile-monitor pages return 404', async ({ request }) => {
  for (const url of ['usage', 'mobile-monitor', 'usage.html', 'mobile-monitor.html', 'ja/usage', 'ja/mobile-monitor']) {
    const response = await request.get(url);
    expect(response.status(), url).toBe(404);
  }
  // The guide version of the mobile page is the replacement.
  expect((await request.get('guide/operations/mobile-monitor')).status()).toBe(200);
});
