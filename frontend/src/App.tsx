import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Braces, KeyRound, LayoutGrid, Lock, Network, Plus, Radio, ScrollText, Server, Settings as SettingsIcon, Terminal as TermIcon, Users, Workflow, X, FolderOpen,
} from 'lucide-react'
import { api, on, uid, whenReady } from './api'
import { initBus } from './termBus'
import { toast } from './toast'
import { I18nContext, loadStoredLang, storeLang, translate } from './i18n'
import type { Lang } from './i18n'
import { loadStoredUiTheme, storeUiTheme } from './uiTheme'
import type { UiTheme } from './uiTheme'
import { applyTheme, isFamilyId, loadStoredThemeId, resolveTheme, storeThemeId } from './themeEngine'
import type { ThemeManifest } from './themeEngine'
import { plugins } from './pluginEngine'
import type { PluginManifest } from './pluginEngine'
import Unlock from './components/Unlock'
import Prompts from './components/Prompts'
import Toasts from './components/Toasts'
import HostsView from './components/HostsView'
import TerminalView from './components/TerminalView'
import FileManager from './components/FileManager'
import Keychain from './components/Keychain'
import Forwarding from './components/Forwarding'
import type { FwdStates } from './components/Forwarding'
import Snippets from './components/Snippets'
import Flows from './components/Flows'
import Team from './components/Team'
import SettingsView from './components/Settings'
import LogsView from './components/LogsView'
import Palette from './components/Palette'
import TabSwitcher from './components/TabSwitcher'
import type { Host, Job, Tab, VaultData } from './types'

type Status = 'loading' | 'uninitialized' | 'locked' | 'unlocked'
// Sections shown inside the pinned "Vaults" destination (Termius-X style: one
// consolidated data tab instead of separate rail destinations).
const NAV = [
  { id: 'hosts', labelKey: 'nav.hosts', icon: Server },
  { id: 'keychain', labelKey: 'nav.keychain', icon: KeyRound },
  { id: 'forwarding', labelKey: 'nav.forwarding', icon: Network },
  { id: 'snippets', labelKey: 'nav.snippets', icon: Braces },
  { id: 'flows', labelKey: 'nav.flows', icon: Workflow },
  { id: 'team', labelKey: 'nav.team', icon: Users },
  { id: 'logs', labelKey: 'nav.logs', icon: ScrollText },
  { id: 'settings', labelKey: 'nav.settings', icon: SettingsIcon },
]
const VAULT_SECTIONS = new Set(NAV.map((n) => n.id))

// App owns state shared across tabs and vault sections. Individual views
// manage their local interaction state and call Go through the Wails bridge.
export default function App() {
  const [status, setStatus] = useState<Status>('loading')
  const [data, setData] = useState<VaultData | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [current, setCurrent] = useState('hosts')
  const [vaultSection, setVaultSection] = useState('hosts')
  const [jobs, setJobs] = useState<Job[]>([])
  const [fwd, setFwd] = useState<FwdStates>({})
  const [broadcast, setBroadcast] = useState(false)
  const [palette, setPalette] = useState(false)
  const [switcher, setSwitcher] = useState(false)
  const [pendingNewHost, setPendingNewHost] = useState<Partial<Host> | null>(null)
  const [addMenu, setAddMenu] = useState(false)
  const [lang, setLang] = useState<Lang>(() => loadStoredLang())
  const [uiTheme, setUiTheme] = useState<UiTheme>(() => loadStoredUiTheme())
  const [uiThemeId, setUiThemeId] = useState<string>(() => loadStoredThemeId())
  const [installedThemes, setInstalledThemes] = useState<ThemeManifest[]>([])
  const [installedPlugins, setInstalledPlugins] = useState<PluginManifest[]>([])

  const tabsRef = useRef(tabs); tabsRef.current = tabs
  const currentRef = useRef(current); currentRef.current = current
  const jobState = useRef<Record<string, string>>({})
  const langRef = useRef(lang); langRef.current = lang
  const t = useCallback((key: string, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang])

  // The authoritative language lives in the vault's settings once it's
  // loaded; before that (Unlock screen), the last choice cached in
  // localStorage is used instead (see loadStoredLang).
  useEffect(() => {
    if (!data?.settings.language) return
    const l = data.settings.language as Lang
    if (l !== lang) setLang(l)
    storeLang(l)
  }, [data?.settings.language])

  // Same pattern for the UI theme: vault settings win once loaded, cached
  // in localStorage for the pre-unlock screen and the next launch.
  useEffect(() => {
    if (!data?.settings.uiTheme) return
    const th = data.settings.uiTheme as UiTheme
    if (th !== uiTheme) setUiTheme(th)
    storeUiTheme(th)
  }, [data?.settings.uiTheme])

  useEffect(() => {
    if (!data?.settings.uiThemeId) return
    const id = data.settings.uiThemeId
    if (id !== uiThemeId) setUiThemeId(id)
    storeThemeId(id)
  }, [data?.settings.uiThemeId])

  const reloadThemes = useCallback(() => {
    api.ThemesList().then((list: ThemeManifest[]) => setInstalledThemes(list ?? [])).catch(() => {})
  }, [])
  useEffect(() => { reloadThemes() }, [reloadThemes])

  const reloadPlugins = useCallback(() => {
    api.PluginsList().then((list: PluginManifest[]) => setInstalledPlugins(list ?? [])).catch(() => {})
  }, [])
  useEffect(() => { reloadPlugins() }, [reloadPlugins])

  // The disabled list is stored in the vault. Start Workers after it is
  // unlocked and tear them down again on lock.
  const vaultUnlocked = status === 'unlocked' && data !== null
  useEffect(() => {
    plugins.reload(vaultUnlocked ? installedPlugins : [], data?.settings.disabledPluginIds ?? [])
  }, [vaultUnlocked, installedPlugins, data?.settings.disabledPluginIds])

  useEffect(() => {
    applyTheme(resolveTheme(uiThemeId, uiTheme, installedThemes))
    if (!isFamilyId(uiThemeId, installedThemes) || uiTheme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme(resolveTheme(uiThemeId, uiTheme, installedThemes))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [uiTheme, uiThemeId, installedThemes])

  const reload = useCallback(async () => {
    try { setData(await api.GetData()) } catch { /* locked */ }
  }, [])

  useEffect(() => {
    initBus()
    whenReady().then(() => {
      api.VaultStatus().then((s: Status) => {
        if (s === 'unlocked') reload().then(() => setStatus('unlocked'))
        else setStatus(s)
      })
      // Drives [data-os] in CSS (macOS's traffic-light inset on the topbar,
      // vs. the plain frame Windows/Linux draw themselves) — see app.go's
      // Platform() and style.css's [data-os="darwin"] rule.
      api.Platform().then((os: string) => { document.documentElement.dataset.os = os })
    })
  }, [])

  // Bind vault-scoped events only while unlocked. Fetch current snapshots
  // after subscribing so events and existing jobs both reach the UI.
  useEffect(() => {
    if (status !== 'unlocked') return
    const offs = [
      on('transfer:update', (j: Job) => {
        setJobs((prev) => {
          const i = prev.findIndex((x) => x.id === j.id)
          if (i < 0) return [...prev, j]
          const n = [...prev]; n[i] = j; return n
        })
        const before = jobState.current[j.id]
        jobState.current[j.id] = j.state
        if (before !== j.state) {
          if (j.state === 'error') toast(translate(langRef.current, 'shell.transferFailed', { title: j.title, error: j.error }), 'err', 8000)
          if (j.state === 'done') toast(translate(langRef.current, 'shell.transferFinished', { title: j.title }), 'ok')
        }
      }),
      on('fwd:status', (m: any) => setFwd((p) => ({ ...p, [m.id]: { state: m.state, error: m.error } }))),
      on('transfer:list', (l: Job[]) => setJobs(l ?? [])),
      on('vault:changed', () => reload()),
    ]
    api.TransferList().then((l: Job[]) => { setJobs(l); l.forEach((j) => { jobState.current[j.id] = j.state }) })
    api.FwdRunning().then((ids: string[]) => setFwd(Object.fromEntries(ids.map((id) => [id, { state: 'running', error: '' }]))))
    return () => offs.forEach((f) => f())
  }, [status])

  // ------------------------------------------------------------ tabs
  const addTab = (t: Tab) => { setTabs((x) => [...x, t]); setCurrent(t.id) }
  const openTerminal = (h: Host) => addTab({ id: uid(), kind: 'terminal', title: h.label, hostId: h.id, color: h.color })
  const openLocal = () => addTab({ id: uid(), kind: 'local', title: t('shell.thisComputer'), color: 'var(--muted)' })
  const openSftp = (h?: Host) =>
    addTab({
      id: uid(), kind: 'sftp', title: h ? t('shell.filesTab', { label: h.label }) : t('shell.filesOnly'),
      hostId: h?.id, color: h?.color ?? 'var(--muted)',
    })

  const closeTab = (id: string) => {
    const list = tabsRef.current
    const idx = list.findIndex((t) => t.id === id)
    const next = list.filter((t) => t.id !== id)
    setTabs(next)
    if (currentRef.current === id) setCurrent(next[Math.min(idx, next.length - 1)]?.id ?? 'hosts')
  }

  const lock = async () => {
    await api.VaultLock()
    setTabs([]); setData(null); setJobs([]); setFwd({}); setCurrent('hosts'); setBroadcast(false)
    setStatus('locked')
  }

  // ------------------------------------------------------------ shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (status !== 'unlocked' || !(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      const eat = () => { e.preventDefault(); e.stopPropagation() }
      if (k === 'k') { eat(); setPalette(true) }
      else if (k === 'j') { eat(); setSwitcher(true) }
      else if (k === 't') { eat(); openLocal() }
      else if (k === 'w') {
        const t = tabsRef.current.find((x) => x.id === currentRef.current)
        if (t) { eat(); closeTab(t.id) }
      } else if (/^[1-9]$/.test(k)) {
        const t = tabsRef.current[Number(k) - 1]
        if (t) { eat(); setCurrent(t.id) }
      } else if (e.shiftKey && (k === ']' || k === '}' || k === '[' || k === '{')) {
        const list = tabsRef.current
        if (!list.length) return
        eat()
        const i = list.findIndex((x) => x.id === currentRef.current)
        const step = k === ']' || k === '}' ? 1 : -1
        setCurrent(list[(i + step + list.length) % list.length].id)
      }
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [status])

  const i18n = { lang, t }

  if (status === 'loading') {
    return (
      <I18nContext.Provider value={i18n}>
        <div className="unlock muted">{t('shell.starting')}</div>
      </I18nContext.Provider>
    )
  }
  if (status !== 'unlocked' || !data) {
    return (
      <I18nContext.Provider value={i18n}>
        <Unlock status={status} lang={lang} onLangChange={(l) => { setLang(l); storeLang(l) }}
          onDone={async () => { await reload(); setStatus('unlocked') }} />
        <Toasts />
      </I18nContext.Provider>
    )
  }

  const termTabs = tabs.filter((t) => t.kind !== 'sftp')
  const tabIcon = (t: Tab) => (
    <span className="dot" style={{ background: t.color || 'var(--accent)' }} />
  )
  const onVaults = VAULT_SECTIONS.has(current)
  const goVaults = () => setCurrent(vaultSection)
  const setSection = (id: string) => { setVaultSection(id); setCurrent(id) }
  const jump = (key: string) => (key === 'vaults' ? goVaults() : setCurrent(key))
  const onNewHost = (h: Partial<Host>) => { setSection('hosts'); setPendingNewHost(h) }

  return (
    <I18nContext.Provider value={i18n}>
    <div className="app">
      <div className="topbar">
        <button className={`tab vaults-tab ${onVaults ? 'active' : ''}`} onClick={goVaults} title={`${t('shell.vaultsTitle')}  ⌘J`}>
          <LayoutGrid size={15} /><span>{t('shell.vaultsTitle')}</span>
        </button>
        <div className="topbar-sep" />
        {tabs.map((tb) => (
          <div key={tb.id} role="button" tabIndex={-1} className={`tab ${current === tb.id ? 'active' : ''}`} onClick={() => setCurrent(tb.id)}>
            {tabIcon(tb)}
            <span className="ellipsis grow" style={{ textAlign: 'left' }}>{tb.title}</span>
            <button className="x" onClick={(e) => { e.stopPropagation(); closeTab(tb.id) }}><X size={13} /></button>
          </div>
        ))}
        <div style={{ position: 'relative' }}>
          <button className="icon-btn tab-add" title={t('shell.newTab')} onClick={() => setAddMenu((m) => !m)}><Plus size={16} /></button>
          {addMenu && (
            <div className="menu" style={{ left: 0, top: 34 }} onMouseLeave={() => setAddMenu(false)} onClick={() => setAddMenu(false)}>
              <button onClick={() => setPalette(true)}><Server size={14} /> {t('shell.connectToHost')}  <span className="faint">⌘K</span></button>
              <button onClick={openLocal}><TermIcon size={14} /> {t('shell.localTerminal')}  <span className="faint">⌘T</span></button>
              <button onClick={() => openSftp()}><FolderOpen size={14} /> {t('shell.fileManager')}</button>
            </div>
          )}
        </div>
        <div className="tabbar-end">
          {termTabs.length > 1 && (
            <button className={`btn sm ${broadcast ? 'primary' : ''}`} onClick={() => setBroadcast((b) => !b)}
              title={t('shell.broadcastTitle')}>
              <Radio size={13} /> {t('shell.broadcastInput')}
            </button>
          )}
        </div>
      </div>

      <div className="content">
        <div className={`tabpane ${onVaults ? 'show' : ''}`}>
          <div className="vaults-shell">
            <nav className="side-nav">
              {NAV.map((n) => (
                <button key={n.id} className={`side-nav-item ${current === n.id ? 'active' : ''}`} onClick={() => setSection(n.id)}>
                  <n.icon size={16} /><span>{t(n.labelKey)}</span>
                </button>
              ))}
              <div className="side-nav-space" />
              <button className="side-nav-item" onClick={lock}><Lock size={16} /><span>{t('nav.lock')}</span></button>
            </nav>
            <div className="vaults-body">
              {current === 'hosts' && (
                <HostsView data={data} reload={reload} onConnect={openTerminal} onSftp={openSftp}
                  pendingNewHost={pendingNewHost} onPendingNewHostHandled={() => setPendingNewHost(null)} />
              )}
              {current === 'keychain' && <Keychain data={data} reload={reload} />}
              {current === 'forwarding' && <Forwarding data={data} reload={reload} states={fwd} />}
              {current === 'snippets' && <Snippets data={data} reload={reload} />}
              {current === 'flows' && <Flows data={data} reload={reload} />}
              {current === 'team' && <Team data={data} reload={reload} />}
              {current === 'logs' && <LogsView />}
              {current === 'settings' && (
                <SettingsView
                  data={data} reload={reload} onLock={lock}
                  installedThemes={installedThemes} reloadThemes={reloadThemes}
                  installedPlugins={installedPlugins} reloadPlugins={reloadPlugins}
                />
              )}
            </div>
          </div>
        </div>

        {tabs.map((tb) => (
          <div key={tb.id} className={`tabpane ${current === tb.id ? 'show' : ''}`}>
            {tb.kind === 'sftp' ? (
              <FileManager tab={tb} active={current === tb.id} data={data} jobs={jobs} />
            ) : (
              <TerminalView tab={tb} active={current === tb.id} settings={data.settings} snippets={data.snippets}
                commandStats={data.commandStats} broadcast={broadcast} onFocus={() => {}} />
            )}
          </div>
        ))}
      </div>

      {palette && (
        <Palette data={data} onClose={() => setPalette(false)} onTerminal={openTerminal} onSftp={openSftp}
          onLocalTerminal={openLocal} onLocalFiles={() => openSftp()} onNewHost={onNewHost} />
      )}
      {switcher && <TabSwitcher tabs={tabs} onClose={() => setSwitcher(false)} onJump={jump} />}
      <Prompts />
      <Toasts />
    </div>
    </I18nContext.Provider>
  )
}
