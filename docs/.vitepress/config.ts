import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const repo = 'https://github.com/FooQoo/agent-board'

type Page = { file: string; en: string; ja: string }
type Group = { en: string; ja: string; pages: Page[] }

// Each chapter keeps its first group at the chapter root and the other groups in folders.
const guideGroups: Group[] = [
  {
    en: 'Get started',
    ja: 'はじめる',
    pages: [
      { file: 'index', en: 'Introduction', ja: 'はじめに' },
      { file: 'getting-started', en: 'Install and start', ja: 'インストールと起動' },
      { file: 'quickstart', en: 'Quickstart', ja: 'クイックスタート' },
      { file: 'concepts', en: 'Core concepts', ja: '基本の考え方' },
    ],
  },
  {
    en: 'Use the board',
    ja: 'ボードを使う',
    pages: [
      { file: 'use/board', en: 'The board', ja: 'ボード' },
      { file: 'use/decisions', en: 'Decisions', ja: '判断依頼' },
      { file: 'use/epics', en: 'Epics and progress', ja: 'エピックと進行表' },
      { file: 'use/editing', en: 'Editing and evidence', ja: '編集と証跡' },
    ],
  },
  {
    en: 'Agents and the CLI',
    ja: 'エージェントとCLI',
    pages: [
      { file: 'automation/agents', en: 'Working with agents', ja: 'エージェントとの連携' },
      { file: 'automation/cli', en: 'CLI reference', ja: 'CLIリファレンス' },
      { file: 'automation/file-format', en: 'Markdown file format', ja: 'Markdownファイルの形式' },
    ],
  },
  {
    en: 'Operations',
    ja: '運用',
    pages: [
      { file: 'operations/mobile-monitor', en: 'Mobile monitor', ja: 'モバイルモニター' },
      { file: 'operations/data', en: 'Data and backups', ja: 'データとバックアップ' },
      { file: 'operations/troubleshooting', en: 'Troubleshooting', ja: 'トラブルシューティング' },
    ],
  },
]

const devGroups: Group[] = [
  {
    en: 'Get started',
    ja: 'はじめる',
    pages: [
      { file: 'index', en: 'Developer guide', ja: '開発者ガイド' },
      { file: 'getting-started/setup', en: 'Set up and run', ja: '開発環境のセットアップ' },
      { file: 'getting-started/first-change', en: 'Follow your first change', ja: '最初の変更を追う' },
      { file: 'getting-started/pull-request', en: 'Verify and open a pull request', ja: '検証とプルリクエスト' },
    ],
  },
  {
    en: 'Concepts',
    ja: '基本の考え方',
    pages: [
      { file: 'concepts/overview', en: 'How Agent Board works', ja: 'Agent Boardの仕組み' },
      { file: 'concepts/tasks-and-states', en: 'Tasks and states', ja: 'タスクと状態' },
      { file: 'concepts/history-and-decisions', en: 'History and decisions', ja: '履歴と判断依頼' },
      { file: 'concepts/saving-and-recovery', en: 'Saving and recovery', ja: '保存と復旧' },
      { file: 'concepts/notifications', en: 'Change notifications', ja: '変更の通知' },
      { file: 'concepts/server-and-ui', en: 'Server and web UI', ja: 'サーバーと画面' },
      { file: 'concepts/agents', en: 'Agent integration', ja: 'エージェント連携' },
      { file: 'concepts/remote-access', en: 'Remote access and the mobile monitor', ja: 'リモートアクセスとモバイルモニター' },
      { file: 'concepts/security', en: 'Security model', ja: 'セキュリティモデル' },
    ],
  },
  {
    en: 'Reference',
    ja: 'リファレンス',
    pages: [
      { file: 'reference/files', en: 'Shared files', ja: '共有ファイル' },
      { file: 'reference/web-api', en: 'Web API', ja: 'Web API' },
      { file: 'reference/errors', en: 'Error codes', ja: 'エラーコード' },
      { file: 'reference/agent-output', en: 'Hook, progress, and wait output', ja: 'Hook・進行表・waitの出力' },
      { file: 'reference/remote-routes', en: 'Remote and monitor routes', ja: 'リモート・モニターのルート' },
      { file: 'reference/code-map', en: 'Code map', ja: 'コード構成' },
    ],
  },
  {
    en: 'Help',
    ja: 'ヘルプ',
    pages: [
      { file: 'troubleshooting', en: 'Troubleshooting', ja: 'トラブルシューティング' },
      { file: 'docs-and-images', en: 'Documentation and images', ja: 'ドキュメントと画像' },
    ],
  },
]

function pageLink(prefix: string, chapter: string, file: string): string {
  return file === 'index' ? `${prefix}/${chapter}/` : `${prefix}/${chapter}/${file}`
}

function sidebar(prefix: string, chapter: string, lang: 'en' | 'ja', groups: Group[]) {
  return groups.map((group) => ({
    text: group[lang],
    items: group.pages.map((page) => ({
      text: page[lang],
      link: pageLink(prefix, chapter, page.file),
    })),
  }))
}

// https://vitepress.dev/reference/site-config
export default withMermaid(
  defineConfig({
    title: 'Agent Board',
    base: '/agent-board/',
    cleanUrls: true,
    mermaid: {
      flowchart: { useMaxWidth: false },
      sequence: { useMaxWidth: false },
    },
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
            { text: 'Developers', link: '/dev/', activeMatch: '/dev/' },
            { text: 'GitHub', link: repo },
          ],
          sidebar: {
            '/guide/': sidebar('', 'guide', 'en', guideGroups),
            '/dev/': sidebar('', 'dev', 'en', devGroups),
          },
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
            { text: '開発者向け', link: '/ja/dev/', activeMatch: '/ja/dev/' },
            { text: 'GitHub', link: repo },
          ],
          sidebar: {
            '/ja/guide/': sidebar('/ja', 'guide', 'ja', guideGroups),
            '/ja/dev/': sidebar('/ja', 'dev', 'ja', devGroups),
          },
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
