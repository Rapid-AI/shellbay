import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { Braces, ChevronDown, ChevronUp, Eraser, Search, X } from 'lucide-react'
import { api, errMsg, openURL } from '../api'
import { attach, detach, live } from '../termBus'
import { themeByName } from '../themes'
import { useI18n } from '../i18n'
import TermSuggest from './TermSuggest'
import { BASE_COMMANDS, mergeSuggestions, parseHelpOutput } from '../termSuggest'
import type { FlagSuggestion } from '../termSuggest'
import { plugins } from '../pluginEngine'
import type { CommandStat, Settings, Snippet, Tab } from '../types'

interface Props {
  tab: Tab
  active: boolean
  settings: Settings
  snippets: Snippet[]
  commandStats: CommandStat[]
  broadcast: boolean
  onFocus: (id: string) => void
}

function buildStatsIndex(stats: CommandStat[]): Record<string, Record<string, number>> {
  const idx: Record<string, Record<string, number>> = {}
  for (const s of stats) (idx[s.command] ?? (idx[s.command] = {}))[s.flag] = s.count
  return idx
}

const COMMAND_TOKEN = /^[a-zA-Z0-9_./-]{1,40}$/

// The command is always the first token; the "partial" is whatever's being
// typed right now (empty if the line just ends in whitespace). Works for
// any number of prior arguments, not just a single trailing one.
function currentCommandAndPartial(line: string): { cmd: string; partial: string } | null {
  if (!line.trim()) return null
  const endsWithSpace = /\s$/.test(line)
  const tokens = line.trim().split(/\s+/)
  if (tokens.length < 2 && !endsWithSpace) return null // still typing the command name itself
  return { cmd: tokens[0], partial: endsWithSpace ? '' : tokens[tokens.length - 1] }
}

export default function TerminalView({ tab, active, settings, snippets, commandStats, broadcast, onFocus }: Props) {
  const { t } = useI18n()
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const sessionRef = useRef('')
  const broadcastRef = useRef(broadcast)
  broadcastRef.current = broadcast
  const [state, setState] = useState<'connecting' | 'open' | 'closed'>('connecting')
  const [reason, setReason] = useState('')
  const [find, setFind] = useState(false)
  const [needle, setNeedle] = useState('')
  const [menu, setMenu] = useState(false)

  // ---- command suggestion engine (best-effort local line tracking; see
  // frontend/src/termSuggest.ts for the merge/parsing logic) ----
  const [suggestions, setSuggestions] = useState<FlagSuggestion[]>([])
  const [selIdx, setSelIdx] = useState(0)
  const lineBufRef = useRef('')
  const liveHelpRef = useRef<Record<string, { flag: string; desc: string }[]>>({})
  const fetchingRef = useRef<Set<string>>(new Set())
  // Plugin-contributed suggestions (see pluginEngine.ts), cached per command
  // the same way the live "--help" fetch is — fetched once, not re-run per
  // keystroke; mergeSuggestions' own `filter` param narrows by the current
  // partial flag. Local-shell tabs get these too since, unlike CommandHelp,
  // a plugin doesn't need a live host connection to answer.
  const pluginHelpRef = useRef<Record<string, { flag: string; desc: string }[]>>({})
  const pluginFetchingRef = useRef<Set<string>>(new Set())
  const statsIndexRef = useRef<Record<string, Record<string, number>>>(buildStatsIndex(commandStats))
  useEffect(() => { statsIndexRef.current = buildStatsIndex(commandStats) }, [commandStats])

  function send(data: string) {
    const id = sessionRef.current
    if (!id) return
    if (broadcastRef.current) live.forEach((sid) => { api.TermWrite(sid, data).catch(() => {}) })
    else api.TermWrite(id, data).catch(() => {})
  }

  function closeSuggestions() { setSuggestions([]); setSelIdx(0) }

  // Show built-ins immediately and merge asynchronous host/extension
  // results when they arrive. Cache lookups by command per terminal.
  function recomputeSuggestions() {
    const info = currentCommandAndPartial(lineBufRef.current)
    if (!info || !COMMAND_TOKEN.test(info.cmd)) { closeSuggestions(); return }
    const { cmd, partial } = info
    if (partial && !partial.startsWith('-')) { closeSuggestions(); return } // typing a plain argument, not a flag
    const base = BASE_COMMANDS[cmd] ?? []
    const liveList = [...(liveHelpRef.current[cmd] ?? []), ...(pluginHelpRef.current[cmd] ?? [])]
    const merged = mergeSuggestions(base, liveList, statsIndexRef.current[cmd] ?? {}, partial)
    setSuggestions(merged)
    setSelIdx(0)

    if (tab.hostId && !(cmd in liveHelpRef.current) && !fetchingRef.current.has(cmd)) {
      fetchingRef.current.add(cmd)
      api.CommandHelp(tab.hostId, cmd)
        .then((text: string) => {
          liveHelpRef.current[cmd] = text ? parseHelpOutput(text) : []
          if (lineBufRef.current.startsWith(cmd)) recomputeSuggestions()
        })
        .catch(() => { liveHelpRef.current[cmd] = [] })
    }

    if (!(cmd in pluginHelpRef.current) && !pluginFetchingRef.current.has(cmd)) {
      pluginFetchingRef.current.add(cmd)
      plugins.getCommandSuggestions(cmd, partial)
        .then((list) => {
          pluginHelpRef.current[cmd] = list
          if (lineBufRef.current.startsWith(cmd)) recomputeSuggestions()
        })
        .catch(() => { pluginHelpRef.current[cmd] = [] })
    }
  }

  function commitLine() {
    const line = lineBufRef.current.trim()
    closeSuggestions()
    if (!line) return
    const tokens = line.split(/\s+/)
    const cmd = tokens[0]
    if (!cmd || !COMMAND_TOKEN.test(cmd)) return
    const flags = tokens.slice(1).filter((x) => x.startsWith('-'))
    const idx = statsIndexRef.current
    const cmdStats = idx[cmd] ?? (idx[cmd] = {})
    for (const f of flags.length ? flags : ['']) cmdStats[f] = (cmdStats[f] ?? 0) + 1
    api.TrackCommandUsage(cmd, flags).catch(() => {})
  }

  function updateLineBuffer(d: string) {
    if (d === '\r' || d === '\n') { commitLine(); lineBufRef.current = ''; return }
    if (d === '\x7f' || d === '\b') { lineBufRef.current = lineBufRef.current.slice(0, -1); return }
    if (d === '\x03' || d === '\x15' || d === '\x17') { lineBufRef.current = ''; closeSuggestions(); return }
    if (d.charCodeAt(0) === 0x1b) return // other escape sequences (arrows, etc.) don't change the buffer
    lineBufRef.current += d
  }

  function acceptSuggestion() {
    const s = suggestions[selIdx]
    if (!s) { closeSuggestions(); return }
    const info = currentCommandAndPartial(lineBufRef.current)
    const partial = info?.partial ?? ''
    const toSend = s.flag.slice(partial.length) + ' '
    lineBufRef.current += toSend
    send(toSend)
    closeSuggestions()
  }

  // Only intercepts Tab/↑/↓/Esc, and only while the popup is actually
  // showing — otherwise every keystroke reaches the server exactly as
  // before, so this never competes with the remote shell's own bindings.
  function handleTermData(d: string) {
    if (suggestions.length > 0) {
      if (d === '\t') { acceptSuggestion(); return }
      if (d === '\x1b[A') { setSelIdx((i) => Math.max(0, i - 1)); return }
      if (d === '\x1b[B') { setSelIdx((i) => Math.min(suggestions.length - 1, i + 1)); return }
      if (d === '\x1b') { closeSuggestions(); return }
    }
    updateLineBuffer(d)
    send(d)
    recomputeSuggestions()
  }
  const handleDataRef = useRef(handleTermData)
  handleDataRef.current = handleTermData

  async function connect() {
    const term = termRef.current
    if (!term) return
    setState('connecting')
    setReason('')
    try {
      const id: string = tab.kind === 'local'
        ? await api.TermOpenLocal(term.rows, term.cols)
        : await api.TermOpen(tab.hostId, term.rows, term.cols)
      sessionRef.current = id
      attach(id, (d) => term.write(d), (r) => {
        detach(id)
        sessionRef.current = ''
        setReason(r)
        setState('closed')
      })
      setState('open')
      term.focus()
    } catch (e) {
      sessionRef.current = ''
      setReason(errMsg(e))
      setState('closed')
    }
  }

  useEffect(() => {
    const term = new Terminal({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      cursorStyle: settings.cursorStyle,
      cursorBlink: true,
      scrollback: settings.scrollback,
      theme: themeByName(settings.theme),
      macOptionIsMeta: true,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(new WebLinksAddon((_e, uri) => openURL(uri)))
    term.open(hostRef.current!)
    termRef.current = term
    fitRef.current = fit
    searchRef.current = search
    try { fit.fit() } catch { /* container not visible yet */ }

    term.onData((d) => handleDataRef.current(d))
    term.onResize(({ rows, cols }) => {
      if (sessionRef.current) api.TermResize(sessionRef.current, rows, cols).catch(() => {})
    })
    const ro = new ResizeObserver(() => {
      if (hostRef.current && hostRef.current.offsetWidth > 0) {
        try { fit.fit() } catch { /* ignore */ }
      }
    })
    ro.observe(hostRef.current!)
    connect()

    return () => {
      ro.disconnect()
      const id = sessionRef.current
      if (id) { detach(id); api.TermClose(id).catch(() => {}) }
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontFamily = settings.fontFamily
    term.options.fontSize = settings.fontSize
    term.options.cursorStyle = settings.cursorStyle
    term.options.scrollback = settings.scrollback
    term.options.theme = themeByName(settings.theme)
    try { fitRef.current?.fit() } catch { /* ignore */ }
  }, [settings.fontFamily, settings.fontSize, settings.cursorStyle, settings.scrollback, settings.theme])

  useEffect(() => {
    if (!active) return
    onFocus(tab.id)
    const t = setTimeout(() => {
      try { fitRef.current?.fit() } catch { /* ignore */ }
      termRef.current?.focus()
    }, 30)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const bg = themeByName(settings.theme).background

  return (
    <div className="term-wrap" style={{ background: bg }}>
      <div className="term-bar">
        <span className="muted ellipsis" style={{ marginRight: 'auto' }}>
          {tab.kind === 'local' ? t('shell.thisComputer') : tab.title}
          {broadcast && <span className="pill run" style={{ marginLeft: 8 }}>{t('term.broadcastOn')}</span>}
        </span>
        {find && (
          <div className="find">
            <input className="input" autoFocus placeholder={t('term.findPlaceholder')} value={needle}
              onChange={(e) => { setNeedle(e.target.value); searchRef.current?.findNext(e.target.value) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.shiftKey ? searchRef.current?.findPrevious(needle) : searchRef.current?.findNext(needle)
                if (e.key === 'Escape') { setFind(false); termRef.current?.focus() }
              }} />
            <button className="icon-btn" onClick={() => searchRef.current?.findPrevious(needle)}><ChevronUp size={15} /></button>
            <button className="icon-btn" onClick={() => searchRef.current?.findNext(needle)}><ChevronDown size={15} /></button>
            <button className="icon-btn" onClick={() => { setFind(false); termRef.current?.focus() }}><X size={15} /></button>
          </div>
        )}
        <div className="toolbar-group">
        {!find && <button className="icon-btn" title={t('term.find')} onClick={() => setFind(true)}><Search size={15} /></button>}
        <button className="icon-btn" title={t('term.clearScreen')} onClick={() => { termRef.current?.clear(); termRef.current?.focus() }}><Eraser size={15} /></button>
        <div style={{ position: 'relative' }}>
          <button className="icon-btn" title={t('term.snippets')} onClick={() => setMenu((m) => !m)}><Braces size={15} /></button>
          {menu && (
            <div className="menu" style={{ right: 0, top: 32 }} onMouseLeave={() => setMenu(false)}>
              {snippets.length === 0 && <div className="muted" style={{ padding: 8 }}>{t('term.noSnippetsYet')}</div>}
              {snippets.map((s) => (
                <button key={s.id} onClick={() => { send(s.command.replace(/\n+$/, '') + '\r'); setMenu(false); termRef.current?.focus() }}>
                  <span className="ellipsis">{s.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>
      <div className="term-host" ref={hostRef} />
      <TermSuggest suggestions={suggestions} selected={selIdx} />
      {state !== 'open' && (
        <div className="term-overlay">
          {state === 'connecting' ? (
            <div className="muted">{t('term.connecting')}</div>
          ) : (
            <>
              <div>
                <h3>{t('term.sessionEnded')}</h3>
                <div className="muted" style={{ marginTop: 4, maxWidth: 460 }}>{reason}</div>
              </div>
              <button className="btn primary" onClick={() => { termRef.current?.reset(); connect() }}>{t('term.reconnect')}</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
