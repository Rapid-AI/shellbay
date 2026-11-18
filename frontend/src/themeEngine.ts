import { resolveUiTheme, type UiTheme } from './uiTheme'
import { BUILTIN_THEMES, builtinThemeById } from './builtinThemes'

export interface ThemeManifest {
  id: string
  name: string
  author?: string
  base: 'dark' | 'light'
  // Groups a dark/light pair under one adaptive choice (e.g. "classic" links
  // classic-dark + classic-light) — see resolveTheme/isFamilyId below. Themes
  // without a family (most user-installed ones) are only ever picked by
  // their own literal id, never adaptively.
  family?: string
  colors: Record<string, string>
  radii?: Record<string, string>
  terminal?: Record<string, string>
}

// The full set of custom-property names style.css's :root blocks define.
// Used to clear a previous theme's overrides before applying a new one, so
// a sparse/partial custom theme correctly falls back to the base scheme's
// value for anything it doesn't set, instead of inheriting the last theme's
// value for that token.
export const THEME_TOKEN_KEYS = [
  'bg', 'rail', 'panel', 'panel-2', 'panel-3', 'hover', 'line', 'line-soft', 'text', 'muted',
  'faint', 'accent', 'on-accent', 'accent-soft', 'accent-text', 'input-bg', 'ok', 'warn', 'danger',
  'scroll-thumb', 'scroll-thumb-hover',
]

const THEME_ID_KEY = 'shellbay_ui_theme_id'
// "classic" is the default family — Classic Dark/Light (the former Termix
// concept palette), adaptive with the light/dark/system picker. "simple"
// (Shell Bay's original look, pre-Termix) stays selectable from the gallery
// like any other theme/family.
export const DEFAULT_FAMILY = 'classic'

export function loadStoredThemeId(): string {
  try {
    const v = localStorage.getItem(THEME_ID_KEY) ?? localStorage.getItem('harbor_ui_theme_id')
    if (v) return v
  } catch { /* ignore */ }
  return DEFAULT_FAMILY
}

export function storeThemeId(id: string) {
  try { localStorage.setItem(THEME_ID_KEY, id) } catch { /* ignore */ }
}

const allThemes = (installed: ThemeManifest[]) => [...BUILTIN_THEMES, ...installed]

// True when id names a family (e.g. "classic") rather than one literal theme.
export function isFamilyId(id: string, installed: ThemeManifest[]): boolean {
  return allThemes(installed).some((t) => t.family === id)
}

// resolveTheme picks the manifest to actually paint. A family id (the
// default "classic", or "simple") means "adaptive": follow the light/dark/
// system preference between that family's dark/light pair. Any other id is
// a specific theme choice (built-in or user-installed) that overrides the
// light/dark/system picker; falls back to the default family (or, failing
// that, classic-dark) if the id isn't found — e.g. a theme was deleted.
export function resolveTheme(themeId: string, uiTheme: UiTheme, installed: ThemeManifest[]): ThemeManifest {
  const id = themeId || DEFAULT_FAMILY
  const all = allThemes(installed)
  const family = all.filter((t) => t.family === id)
  if (family.length) {
    const resolved = resolveUiTheme(uiTheme)
    return family.find((t) => t.base === resolved) ?? family[0]
  }
  return all.find((t) => t.id === id) ?? builtinThemeById('classic-dark')!
}

const RADII_KEYS = ['shape-xs', 'shape-sm', 'shape-md', 'shape-lg', 'shape-xl', 'shape-full']

// applyTheme paints a manifest onto the document root: data-theme picks the
// structural fallback scheme (style.css's two :root blocks), data-theme-id
// names the exact theme so style.css can hook non-color differences (e.g.
// the side-nav's active-item treatment) onto a specific theme, and every
// color/radius token the manifest defines is set as an inline custom
// property on top. Tokens the manifest doesn't define are explicitly
// cleared first so they fall back to the base scheme instead of lingering
// from a prior theme.
export function applyTheme(theme: ThemeManifest) {
  const root = document.documentElement
  root.dataset.theme = theme.base
  root.dataset.themeId = theme.id
  root.style.colorScheme = theme.base
  for (const key of THEME_TOKEN_KEYS) {
    const value = theme.colors[key]
    if (value) root.style.setProperty(`--${key}`, value)
    else root.style.removeProperty(`--${key}`)
  }
  for (const key of RADII_KEYS) {
    const value = theme.radii?.[key]
    if (value) root.style.setProperty(`--${key}`, value)
    else root.style.removeProperty(`--${key}`)
  }
}

export { BUILTIN_THEMES }
export type { UiTheme }
