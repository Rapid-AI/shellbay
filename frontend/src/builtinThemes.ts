import type { ThemeManifest } from './themeEngine'

// Naming history: the Termix-concept palette below was originally shipped as
// a second theme ("termix-dark"/"termix-light") alongside Shell Bay's original
// look ("classic-dark"/"classic-light"). The user then asked to make the
// Termix palette the new default/"classic" and rename the original look to
// "simple" — so the ids below reflect that swap, not the original palette
// each name suggests. See PLAN.md's phase log for the full history.

// simple-dark / simple-light are Shell Bay's original look (exact values from
// style.css's pre-theme-engine :root / :root[data-theme="light"] blocks),
// kept as the plainer alternative now that the Termix palette is "classic".
// style.css keeps those two blocks as the structural fallback (any var a
// theme doesn't override still resolves sensibly); themeEngine.applyTheme
// layers a manifest's colors on top as inline custom properties.

const simpleDark: ThemeManifest = {
  id: 'simple-dark',
  name: 'Simple Dark',
  base: 'dark',
  family: 'simple',
  colors: {
    bg: '#0d1220', rail: '#090d18', panel: '#131a2b', 'panel-2': '#19213a', 'panel-3': '#212b4a',
    hover: '#1c2542', line: '#222c45', 'line-soft': '#1a2238', text: '#dde4f3', muted: '#8591ad',
    faint: '#5a6684', accent: '#5b8cff', 'on-accent': '#fff',
    'accent-soft': 'color-mix(in srgb, #5b8cff 16%, transparent)', 'accent-text': '#bcd0ff',
    'input-bg': '#0b1020', ok: '#46d39a', warn: '#f0b95b', danger: '#ff6b7d',
    'scroll-thumb': '#2a3556', 'scroll-thumb-hover': '#38466e',
  },
}

const simpleLight: ThemeManifest = {
  id: 'simple-light',
  name: 'Simple Light',
  base: 'light',
  family: 'simple',
  colors: {
    bg: '#f9fafe', rail: '#eef1fa', panel: '#ffffff', 'panel-2': '#f1f3fb', 'panel-3': '#e7eaf6',
    hover: '#eaedf8', line: '#d6dbea', 'line-soft': '#e3e6f1', text: '#1b1f2a', muted: '#5b6479',
    faint: '#8891a6', accent: '#3a62d8', 'on-accent': '#fff',
    'accent-soft': 'color-mix(in srgb, #3a62d8 12%, transparent)', 'accent-text': '#1c3fa0',
    'input-bg': '#eef1fa', ok: '#1e7a4c', warn: '#8a5a00', danger: '#c0293b',
    'scroll-thumb': '#c7ccdc', 'scroll-thumb-hover': '#aeb4cb',
  },
}

// classic-dark: palette lifted from the user's own redesign concept (a Tauri
// UI + Tailwind mockup, deep navy chrome with a mint/teal accent) — see
// PLAN.md Phase 2. Colors only; the concept's structural differences (the
// side nav's left-accent-bar active state instead of a solid fill) hook
// off [data-theme-id^="classic-"] in style.css since the theme format
// doesn't carry markup/shape intent, just tokens.
const classicDark: ThemeManifest = {
  id: 'classic-dark',
  name: 'Classic Dark',
  base: 'dark',
  family: 'classic',
  colors: {
    bg: '#0a0f1f', rail: '#0a0e1c', panel: '#111a30', 'panel-2': '#16213c', 'panel-3': '#1c2a4a',
    hover: '#18233f', line: '#223154', 'line-soft': '#1a2440', text: '#e8edf7', muted: '#8fa0c0',
    faint: '#5e6f91', accent: '#22d3a6', 'on-accent': '#06241c',
    'accent-soft': 'color-mix(in srgb, #22d3a6 16%, transparent)', 'accent-text': '#7ff0d2',
    'input-bg': '#0d1428', ok: '#22d3a6', warn: '#f0b95b', danger: '#ff6b7d',
    'scroll-thumb': '#253357', 'scroll-thumb-hover': '#324568',
  },
}

// classic-light: the same mint/teal identity, deepened slightly (#0ea37d
// instead of #22d3a6) so it still reads as accent text/icons against white
// panels, not just as a button fill.
const classicLight: ThemeManifest = {
  id: 'classic-light',
  name: 'Classic Light',
  base: 'light',
  family: 'classic',
  colors: {
    bg: '#f4f9f7', rail: '#eef6f3', panel: '#ffffff', 'panel-2': '#eef6f4', 'panel-3': '#e3f1ec',
    hover: '#e6f3ef', line: '#cfe3dd', 'line-soft': '#dcece6', text: '#102420', muted: '#50685f',
    faint: '#8aa69c', accent: '#0ea37d', 'on-accent': '#ffffff',
    'accent-soft': 'color-mix(in srgb, #0ea37d 12%, transparent)', 'accent-text': '#07734f',
    'input-bg': '#eef6f4', ok: '#0ea37d', warn: '#8a5a00', danger: '#c0293b',
    'scroll-thumb': '#c3ded5', 'scroll-thumb-hover': '#a9cdc1',
  },
}

export const BUILTIN_THEMES: ThemeManifest[] = [classicDark, classicLight, simpleDark, simpleLight]
export const builtinThemeById = (id: string) => BUILTIN_THEMES.find((t) => t.id === id)
