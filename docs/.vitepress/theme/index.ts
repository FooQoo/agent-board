import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import LandingPage from './LandingPage.vue'
import Layout from './Layout.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    // The home pages (docs/index.md and docs/ja/index.md) render <LandingPage /> from their frontmatter.
    app.component('LandingPage', LandingPage)
  },
} satisfies Theme
