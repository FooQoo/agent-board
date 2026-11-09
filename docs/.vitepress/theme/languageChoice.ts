// The top page picks its language in the browser. The built HTML stays the same for every
// visitor and crawler; only a browser that runs scripts moves.
//
// - languageRedirectScript() is inlined in the head of the English top page only, so it runs
//   before the page renders. It opens the Japanese top page when the saved choice is Japanese,
//   or, with no saved choice, when the browser's first preferred language is Japanese.
// - rememberLanguageChoice() saves the language a reader picks in the nav's language menu.
//   After that the saved choice wins over the browser language.
//
// Deep links never move: the script is only on the top page, and it checks the path again.

export const languageStorageKey = 'agent-board-docs-lang'

export type DocsLang = 'en' | 'ja'

export function languageRedirectScript(base: string): string {
  const b = JSON.stringify(base)
  const key = JSON.stringify(languageStorageKey)
  return (
    `(function(){var b=${b},p=location.pathname;` +
    `if(p!==b&&p!==b+"index.html"&&p+"/"!==b)return;` +
    `var c=null;try{c=localStorage.getItem(${key})}catch(e){}` +
    `var l=c==="ja"||c==="en"?c:((navigator.languages&&navigator.languages[0])||navigator.language||"");` +
    `if(/^ja(-|$)/i.test(l))location.replace(b+"ja/"+location.search+location.hash)})()`
  )
}

function saveLanguage(lang: DocsLang) {
  try {
    localStorage.setItem(languageStorageKey, lang)
  } catch {
    // Storage can be blocked (private windows, site data turned off); the choice is then not kept.
  }
}

// Watch clicks on the desktop and mobile language menus. A link into /ja/ picks Japanese;
// every other locale link picks English.
export function rememberLanguageChoice(base: string) {
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest<HTMLAnchorElement>(
        '.VPNavBarTranslations a[href], .VPNavScreenTranslations a[href]',
      )
      if (!link) return
      const path = new URL(link.href, location.href).pathname
      saveLanguage(path === `${base}ja` || path.startsWith(`${base}ja/`) ? 'ja' : 'en')
    },
    true,
  )
}
