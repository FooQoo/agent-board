import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import LandingPage from './LandingPage.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // The home pages (docs/index.md and docs/ja/index.md) render <LandingPage /> from their frontmatter.
    app.component('LandingPage', LandingPage)
  },
} satisfies Theme
