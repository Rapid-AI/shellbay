import { createRoot } from 'react-dom/client'
import App from './App'
import { loadStoredUiTheme } from './uiTheme'
import { applyTheme, loadStoredThemeId, resolveTheme } from './themeEngine'
import './style.css'

// Applied before the first paint so there's no flash of the wrong theme —
// the vault's own setting takes over once it loads (see App.tsx). Only
// built-in themes can be resolved this early (no installed-theme list yet
// without an async round-trip); a pinned custom theme briefly shows its
// light/dark base scheme until App.tsx's effect repaints it.
applyTheme(resolveTheme(loadStoredThemeId(), loadStoredUiTheme(), []))

// No StrictMode on purpose: terminals open real sessions in effects.
createRoot(document.getElementById('root')!).render(<App />)
