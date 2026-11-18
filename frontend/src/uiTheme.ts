export type UiTheme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'shellbay_ui_theme'
const DEFAULT_THEME: UiTheme = 'dark'

// resolveUiTheme turns the user's preference into an actual light/dark
// value, following the OS appearance when the preference is "system".
export function resolveUiTheme(pref: UiTheme): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'dark'
  }
}

// The authoritative preference lives in the vault's settings once it's
// loaded; before that (Unlock screen, first paint), the last choice cached
// in localStorage is used instead — same pattern as loadStoredLang/storeLang
// in i18n.ts.
export function loadStoredUiTheme(): UiTheme {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY) ?? localStorage.getItem('harbor_ui_theme')
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* ignore */ }
  return DEFAULT_THEME
}

export function storeUiTheme(pref: UiTheme) {
  try { localStorage.setItem(THEME_STORAGE_KEY, pref) } catch { /* ignore */ }
}
