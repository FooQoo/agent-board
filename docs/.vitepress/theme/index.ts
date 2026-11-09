import DefaultTheme from 'vitepress/theme'
import { inBrowser, type Theme } from 'vitepress'
import LandingPage from './LandingPage.vue'
import Layout from './Layout.vue'
import { rememberLanguageChoice } from './languageChoice'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app, siteData }) {
    // The home pages (docs/index.md and docs/ja/index.md) render <LandingPage /> from their frontmatter.
    app.component('LandingPage', LandingPage)
    // Keep the language picked in the nav, so the top page opens in it next time.
    if (inBrowser) rememberLanguageChoice(siteData.value.base)
  },
} satisfies Theme
