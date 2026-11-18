export interface TermTheme { name: string; label: string; theme: Record<string, string> }

const mk = (bg: string, fg: string, cur: string, sel: string, c: string[]) => ({
  background: bg, foreground: fg, cursor: cur, cursorAccent: bg, selectionBackground: sel,
  black: c[0], red: c[1], green: c[2], yellow: c[3], blue: c[4], magenta: c[5], cyan: c[6], white: c[7],
  brightBlack: c[8], brightRed: c[9], brightGreen: c[10], brightYellow: c[11], brightBlue: c[12],
  brightMagenta: c[13], brightCyan: c[14], brightWhite: c[15],
})

export const THEMES: TermTheme[] = [
  { name: 'midnight', label: 'Midnight', theme: mk('#0b1020', '#d6deeb', '#5b8cff', 'rgba(91,140,255,0.35)', [
    '#1b2238', '#ff6b7d', '#46d39a', '#f0b95b', '#5b8cff', '#c792ea', '#4fd1e8', '#d6deeb',
    '#4a5578', '#ff8e9b', '#6fe3b5', '#f6cd85', '#85a9ff', '#d9b0f2', '#7fe0f0', '#ffffff']) },
  { name: 'nord', label: 'Nord', theme: mk('#2e3440', '#d8dee9', '#88c0d0', 'rgba(136,192,208,0.3)', [
    '#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
    '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4']) },
  { name: 'dracula', label: 'Dracula', theme: mk('#282a36', '#f8f8f2', '#f8f8f2', 'rgba(98,114,164,0.45)', [
    '#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
    '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff']) },
  { name: 'solarized', label: 'Solarized Dark', theme: mk('#002b36', '#93a1a1', '#93a1a1', 'rgba(38,139,210,0.35)', [
    '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
    '#586e75', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3']) },
  { name: 'paper', label: 'Paper (light)', theme: mk('#fbfbf8', '#2b303b', '#2f5fd0', 'rgba(47,95,208,0.22)', [
    '#2b303b', '#c0392b', '#1e8e5a', '#a87400', '#2f5fd0', '#8e44ad', '#16899b', '#d8dbe2',
    '#6b7385', '#e74c3c', '#27ae60', '#c99100', '#4a7bf0', '#a569bd', '#1ab0c7', '#ffffff']) },
]

export const themeByName = (n: string) => (THEMES.find((t) => t.name === n) ?? THEMES[0]).theme
