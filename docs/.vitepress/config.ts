import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const repo = 'https://github.com/FooQoo/agent-board'

const guidePages = [
  { file: 'index', en: 'Introduction', ja: 'はじめに' },
  { file: 'getting-started', en: 'Getting started', ja: 'インストールと開始' },
  { file: 'board', en: 'The board', ja: 'ボード' },
  { file: 'decisions', en: 'Decisions', ja: '判断依頼' },
  { file: 'epics', en: 'Epics and progress', ja: 'エピックと進行表' },
  { file: 'editing', en: 'Editing and evidence', ja: '編集と証跡' },
  { file: 'agents', en: 'Working with agents', ja: 'エージェントとの連携' },
  { file: 'cli', en: 'CLI reference', ja: 'CLIリファレンス' },
  { file: 'mobile-monitor', en: 'Mobile monitor', ja: 'モバイルモニター' },
  { file: 'data', en: 'Data and backups', ja: 'データとバックアップ' },
]

function guideLink(prefix: string, file: string): string {
  return file === 'index' ? `${prefix}/guide/` : `${prefix}/guide/${file}`
}

function sidebar(prefix: string, lang: 'en' | 'ja', heading: string) {
  return [
    {
      text: heading,
      items: guidePages.map((page) => ({
        text: page[lang],
        link: guideLink(prefix, page.file),
      })),
    },
  ]
}

// https://vitepress.dev/reference/site-config
export default withMermaid(
  defineConfig({
    title: 'Agent Board',
    base: '/agent-board/',
    cleanUrls: true,
    lastUpdated: true,
    vite: {
      optimizeDeps: {
        // Pre-bundle mermaid and its CommonJS dependencies in dev; pnpm does not hoist them.
        include: ['mermaid'],
      },
    },
    head: [['link', { rel: 'icon', type: 'image/png', href: '/agent-board/logo.png' }]],

    locales: {
      root: {
        label: 'English',
        lang: 'en',
        description:
          'A shared work board where users and AI agents keep work moving together.',
        themeConfig: {
          nav: [
            { text: 'Guide', link: '/guide/', activeMatch: '/guide/' },
            { text: 'GitHub', link: repo },
          ],
          sidebar: { '/guide/': sidebar('', 'en', 'Guide') },
          editLink: {
            pattern: `${repo}/edit/main/docs/:path`,
            text: 'Edit this page on GitHub',
          },
        },
      },
      ja: {
        label: '日本語',
        lang: 'ja',
        link: '/ja/',
        description: 'ユーザーとAIが一緒に作業を進める共有ボード。',
        themeConfig: {
          nav: [
            { text: 'ガイド', link: '/ja/guide/', activeMatch: '/ja/guide/' },
            { text: 'GitHub', link: repo },
          ],
          sidebar: { '/ja/guide/': sidebar('/ja', 'ja', 'ガイド') },
          editLink: {
            pattern: `${repo}/edit/main/docs/:path`,
            text: 'GitHubでこのページを編集',
          },
          outline: { label: 'このページの内容' },
          docFooter: { prev: '前のページ', next: '次のページ' },
          darkModeSwitchLabel: '外観',
          lightModeSwitchTitle: 'ライトモードに切り替え',
          darkModeSwitchTitle: 'ダークモードに切り替え',
          sidebarMenuLabel: 'メニュー',
          returnToTopLabel: 'ページの先頭へ',
          langMenuLabel: '言語を変更',
          skipToContentLabel: '本文へ移動',
          lastUpdated: { text: '最終更新' },
        },
      },
    },

    themeConfig: {
      logo: { light: '/logo.png', dark: '/logo-white.png', alt: 'Agent Board' },
      socialLinks: [{ icon: 'github', link: repo }],
      search: {
        provider: 'local',
        options: {
          locales: {
            ja: {
              translations: {
                button: { buttonText: '検索', buttonAriaLabel: '検索' },
                modal: {
                  displayDetails: '詳細を表示',
                  resetButtonTitle: '検索条件をクリア',
                  backButtonTitle: '検索を閉じる',
                  noResultsText: '一致する結果がありません',
                  footer: {
                    selectText: '選択',
                    selectKeyAriaLabel: 'Enter',
                    navigateText: '移動',
                    navigateUpKeyAriaLabel: '上矢印',
                    navigateDownKeyAriaLabel: '下矢印',
                    closeText: '閉じる',
                    closeKeyAriaLabel: 'Esc',
                  },
                },
              },
            },
          },
        },
      },
    },
  }),
)
