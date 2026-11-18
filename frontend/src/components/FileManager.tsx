import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowLeft, ArrowUp, Eye, EyeOff, File as FileIcon, FilePlus, Folder, FolderPlus, FolderSync, HardDrive,
  Link2, RefreshCw, Search, X,
} from 'lucide-react'
import Modal, { Confirm, Field, TextPrompt } from './Modal'
import SyncDialog from './SyncDialog'
import CodeEditor from './CodeEditor'
import { detectLanguage, LANGUAGES, type LanguageId } from '../langDetect'
import { api, errMsg } from '../api'
import { toast } from '../toast'
import { basename, dirname, fmtDate, fmtSize, fmtSpeed, joinPath } from '../util'
import { useI18n } from '../i18n'
import type { Entry, Host, Job, Tab, VaultData } from '../types'

// Each pane owns its own location and selection. Its fsId refers to a
// backend file-system handle and is independent of the saved host ID.
interface PaneState {
  fsId: string
  hostId: string | null
  proto: 'local' | 'ssh' | 'ftp'
  label: string
  home: string
  path: string
  entries: Entry[]
  loading: boolean
  error: string
  sel: string[]
  cursor: string
  anchor: string
  sortKey: 'name' | 'size' | 'modTime' | 'modeStr'
  sortDir: 1 | -1
  showHidden: boolean
  filter: string
  history: string[]
}

interface Place { name: string; path: string }

const emptyPane = (): PaneState => ({
  fsId: '', hostId: null, proto: 'local', label: '', home: '', path: '', entries: [], loading: true, error: '',
  sel: [], cursor: '', anchor: '', sortKey: 'name', sortDir: 1, showHidden: false, filter: '', history: [],
})

function visibleEntries(p: PaneState): Entry[] {
  const f = p.filter.trim().toLowerCase()
  const list = p.entries.filter(
    (e) => (p.showHidden || !e.name.startsWith('.')) && (!f || e.name.toLowerCase().includes(f)),
  )
  return list.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    let r = 0
    switch (p.sortKey) {
      case 'size': r = a.size - b.size; break
      case 'modTime': r = a.modTime - b.modTime; break
      case 'modeStr': r = a.modeStr.localeCompare(b.modeStr); break
      default: r = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    }
    return r * p.sortDir
  })
}

function targetsOf(p: PaneState): Entry[] {
  const vis = visibleEntries(p)
  const set = new Set(p.sel)
  const list = vis.filter((e) => set.has(e.path))
  if (list.length) return list
  const c = vis.find((e) => e.path === p.cursor)
  return c ? [c] : []
}

interface Props { tab: Tab; active: boolean; data: VaultData; jobs: Job[] }

export default function FileManager({ tab, active, data, jobs }: Props) {
  const { t } = useI18n()
  const [panes, setPanes] = useState<PaneState[]>([emptyPane(), emptyPane()])
  const [activeIdx, setActiveIdx] = useState(0)
  const [places, setPlaces] = useState<Place[]>([])
  const [dlg, setDlg] = useState<any>(null)
  const [ctx, setCtx] = useState<null | { x: number; y: number; idx: number; entry: Entry | null }>(null)

  const panesRef = useRef(panes); panesRef.current = panes
  const activeRef = useRef(activeIdx); activeRef.current = activeIdx
  const dataRef = useRef(data); dataRef.current = data
  const reqRef = useRef([0, 0])
  const dragRef = useRef<null | { from: number; paths: string[] }>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const patch = useCallback((i: number, p: Partial<PaneState>) => {
    setPanes((prev) => prev.map((x, k) => (k === i ? { ...x, ...p } : x)))
  }, [])

  const load = useCallback(async (i: number, fsId: string, path: string, record: boolean, keepSel: boolean) => {
    const my = ++reqRef.current[i]
    patch(i, { loading: true, error: '' })
    try {
      const entries: Entry[] = await api.FsList(fsId, path)
      if (my !== reqRef.current[i]) return
      setPanes((prev) => prev.map((x, k) => {
        if (k !== i) return x
        const keep = keepSel && x.fsId === fsId && x.path === path
        const paths = new Set(entries.map((e) => e.path))
        return {
          ...x, fsId, path, entries, loading: false, error: '',
          sel: keep ? x.sel.filter((s) => paths.has(s)) : [],
          cursor: keep && paths.has(x.cursor) ? x.cursor : '',
          anchor: keep ? x.anchor : '',
          history: record && x.path && x.path !== path ? [...x.history, x.path].slice(-50) : x.history,
        }
      }))
    } catch (e) {
      if (my !== reqRef.current[i]) return
      patch(i, { loading: false, error: errMsg(e) })
    }
  }, [patch])

  const closePane = (p: PaneState) => {
    if (!p.fsId) return
    if (p.proto === 'ftp') api.FtpClose(p.fsId).catch(() => {})
    else if (p.proto === 'ssh') api.SftpClose(p.fsId).catch(() => {})
  }

  const openSource = useCallback(async (i: number, hostId: string | null) => {
    closePane(panesRef.current[i])
    const host = hostId ? dataRef.current.hosts.find((h) => h.id === hostId) : null
    const proto: PaneState['proto'] = host ? (host.protocol === 'ftp' ? 'ftp' : 'ssh') : 'local'
    reqRef.current[i]++
    patch(i, {
      fsId: '', hostId, proto, label: host ? host.label : t('fm.thisComputer'), entries: [], path: '', home: '',
      history: [], sel: [], cursor: '', anchor: '', loading: true, error: '',
    })
    try {
      const fsId: string = !hostId ? 'local' : proto === 'ftp' ? await api.FtpOpen(hostId) : await api.SftpOpen(hostId)
      const home: string = await api.FsHome(fsId)
      patch(i, { fsId, home })
      await load(i, fsId, home, false, false)
    } catch (e) {
      patch(i, { loading: false, error: errMsg(e) })
    }
  }, [load, patch, t])

  useEffect(() => {
    api.LocalPlaces().then(setPlaces).catch(() => {})
    openSource(0, null)
    openSource(1, tab.hostId ?? null)
    return () => {
      panesRef.current.forEach(closePane)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = (i: number, path: string) => load(i, panesRef.current[i].fsId, path, true, false)
  const refresh = (i: number) => {
    const p = panesRef.current[i]
    if (p.fsId) load(i, p.fsId, p.path, false, true)
  }
  const refreshFs = (fsId: string) => panesRef.current.forEach((p, i) => { if (p.fsId === fsId) refresh(i) })
  const up = (i: number) => go(i, dirname(panesRef.current[i].path))
  const back = (i: number) => {
    const p = panesRef.current[i]
    if (!p.history.length) return
    const prev = p.history[p.history.length - 1]
    patch(i, { history: p.history.slice(0, -1) })
    load(i, p.fsId, prev, false, false)
  }

  // refresh panes when transfers finish
  const handled = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const j of jobs) {
      const fin = j.state === 'done' || j.state === 'error' || j.state === 'canceled'
      if (fin && !handled.current.has(j.id)) {
        handled.current.add(j.id)
        panesRef.current.forEach((p, i) => {
          if (p.fsId && (p.fsId === j.dstFs || (j.move && p.fsId === j.srcFs))) refresh(i)
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs])

  useEffect(() => {
    if (active) rootRef.current?.focus()
  }, [active])

  // ------------------------------------------------------------ selection
  function click(i: number, e: Entry, ev: React.MouseEvent) {
    setActiveIdx(i)
    const p = panesRef.current[i]
    const vis = visibleEntries(p)
    if (ev.metaKey || ev.ctrlKey) {
      const has = p.sel.includes(e.path)
      patch(i, { sel: has ? p.sel.filter((s) => s !== e.path) : [...p.sel, e.path], cursor: e.path, anchor: e.path })
    } else if (ev.shiftKey && p.anchor) {
      const a = vis.findIndex((x) => x.path === p.anchor)
      const b = vis.findIndex((x) => x.path === e.path)
      const [lo, hi] = a < b ? [a, b] : [b, a]
      patch(i, { sel: vis.slice(Math.max(lo, 0), hi + 1).map((x) => x.path), cursor: e.path })
    } else {
      patch(i, { sel: [e.path], cursor: e.path, anchor: e.path })
    }
  }

  function moveCursor(i: number, delta: number, extend: boolean, absolute?: 'start' | 'end') {
    const p = panesRef.current[i]
    const vis = visibleEntries(p)
    if (!vis.length) return
    let idx = vis.findIndex((e) => e.path === p.cursor)
    if (absolute === 'start') idx = 0
    else if (absolute === 'end') idx = vis.length - 1
    else if (idx < 0) idx = delta > 0 ? 0 : vis.length - 1
    else idx = Math.max(0, Math.min(vis.length - 1, idx + delta))
    const cur = vis[idx]
    if (extend) {
      let a = vis.findIndex((e) => e.path === (p.anchor || p.cursor))
      if (a < 0) a = idx
      const [lo, hi] = a < idx ? [a, idx] : [idx, a]
      patch(i, { cursor: cur.path, sel: vis.slice(lo, hi + 1).map((e) => e.path), anchor: vis[a].path })
    } else {
      patch(i, { cursor: cur.path, sel: [cur.path], anchor: cur.path })
    }
  }

  function selectAll(i: number) {
    const vis = visibleEntries(panesRef.current[i])
    patch(i, { sel: vis.map((e) => e.path) })
  }

  function openEntry(i: number, e: Entry) {
    const p = panesRef.current[i]
    if (e.isDir) { go(i, e.path); return }
    if (!p.hostId) api.OpenPath(e.path).catch((err) => toast(errMsg(err), 'err'))
    else setDlg({ kind: 'edit', fsId: p.fsId, path: e.path })
  }

  // ------------------------------------------------------------ operations
  async function transfer(move: boolean, from: number, opt?: { paths?: string[]; toDir?: string; toPane?: number }) {
    const src = panesRef.current[from]
    const toIdx = opt?.toPane ?? 1 - from
    const dst = panesRef.current[toIdx]
    const paths = opt?.paths ?? targetsOf(src).map((e) => e.path)
    if (!paths.length) { toast(t('fm.selectSomethingFirst')); return }
    if (!src.fsId || !dst.fsId) { toast(t('fm.otherPaneNotConnected'), 'err'); return }
    const dstDir = opt?.toDir ?? dst.path
    let clashes: string[] = []
    try {
      const list: Entry[] = dstDir === dst.path ? dst.entries : await api.FsList(dst.fsId, dstDir)
      const names = new Set(list.map((e) => e.name))
      clashes = paths.map(basename).filter((n) => names.has(n))
    } catch { /* destination may not exist yet */ }
    const run = async (policy: string) => {
      try {
        await api.FsTransfer(src.fsId, dst.fsId, paths, dstDir, move, policy)
      } catch (e) {
        toast(errMsg(e), 'err')
      }
    }
    if (clashes.length) setDlg({ kind: 'conflict', names: clashes, move, run })
    else run('overwrite')
  }

  function newFolder(i: number) {
    const p = panesRef.current[i]
    if (p.fsId) setDlg({ kind: 'mkdir', fsId: p.fsId, dir: p.path })
  }
  function newFile(i: number) {
    const p = panesRef.current[i]
    if (p.fsId) setDlg({ kind: 'newfile', fsId: p.fsId, dir: p.path })
  }
  function rename(i: number) {
    const p = panesRef.current[i]
    const targets = targetsOf(p)
    if (targets.length === 1) setDlg({ kind: 'rename', fsId: p.fsId, entry: targets[0] })
    else toast(t('fm.selectOneToRename'))
  }
  function del(i: number) {
    const p = panesRef.current[i]
    const targets = targetsOf(p)
    if (targets.length) setDlg({ kind: 'delete', fsId: p.fsId, local: !p.hostId, items: targets })
  }
  function compress(i: number) {
    const p = panesRef.current[i]
    const targets = targetsOf(p)
    if (!targets.length) { toast(t('fm.selectSomethingFirst')); return }
    const suggested = targets.length === 1 ? `${targets[0].name.replace(/\.[^./]+$/, '')}.zip` : 'archive.zip'
    setDlg({ kind: 'compress', fsId: p.fsId, dir: p.path, paths: targets.map((e) => e.path), suggested })
  }
  function extractHere(i: number) {
    const p = panesRef.current[i]
    const targets = targetsOf(p)
    if (targets.length !== 1) return
    api.FsExtract(p.fsId, targets[0].path, p.path).catch((e: any) => toast(errMsg(e), 'err'))
  }
  function edit(i: number) {
    const p = panesRef.current[i]
    const targets = targetsOf(p)
    if (targets.length === 1 && !targets[0].isDir) setDlg({ kind: 'edit', fsId: p.fsId, path: targets[0].path })
    else toast(t('fm.selectOneFileToEdit'))
  }
  function props(i: number) {
    const p = panesRef.current[i]
    const targets = targetsOf(p)
    if (targets.length === 1) setDlg({ kind: 'props', fsId: p.fsId, entry: targets[0] })
    else if (!targets.length && p.path) {
      api.FsStat(p.fsId, p.path).then((e: Entry) => setDlg({ kind: 'props', fsId: p.fsId, entry: e })).catch(() => {})
    }
  }
  function search(i: number) {
    const p = panesRef.current[i]
    if (p.fsId) setDlg({ kind: 'search', idx: i, fsId: p.fsId, root: p.path })
  }
  function syncFolders(i: number) {
    const src = panesRef.current[i]
    const dst = panesRef.current[1 - i]
    if (!src.fsId || !dst.fsId) { toast(t('fm.otherPaneNotConnected'), 'err'); return }
    setDlg({ kind: 'sync', srcFs: src.fsId, srcDir: src.path, srcLabel: src.label, dstFs: dst.fsId, dstDir: dst.path, dstLabel: dst.label })
  }

  // ------------------------------------------------------------ keyboard
  function onKey(e: React.KeyboardEvent) {
    const tgt = e.target as HTMLElement
    if (tgt.closest('input,textarea,select,.modal,.menu')) return
    const i = activeRef.current
    const p = panesRef.current[i]
    const meta = e.metaKey || e.ctrlKey
    let handled = true
    switch (e.key) {
      case 'ArrowDown': {
        if (meta) { const c = visibleEntries(p).find((x) => x.path === p.cursor); if (c) openEntry(i, c) }
        else moveCursor(i, 1, e.shiftKey)
        break
      }
      case 'ArrowUp': if (meta) up(i); else moveCursor(i, -1, e.shiftKey); break
      case 'PageDown': moveCursor(i, 12, e.shiftKey); break
      case 'PageUp': moveCursor(i, -12, e.shiftKey); break
      case 'Home': moveCursor(i, 0, e.shiftKey, 'start'); break
      case 'End': moveCursor(i, 0, e.shiftKey, 'end'); break
      case 'ArrowLeft': case 'ArrowRight': case 'Tab': setActiveIdx(1 - i); break
      case 'Enter': { const c = visibleEntries(p).find((x) => x.path === p.cursor); if (c) openEntry(i, c); break }
      case 'Backspace': if (meta) del(i); else up(i); break
      case 'Delete': case 'F8': del(i); break
      case ' ': {
        const vis = visibleEntries(p)
        const idx = vis.findIndex((x) => x.path === p.cursor)
        if (idx >= 0) {
          const c = vis[idx]
          const next = vis[Math.min(idx + 1, vis.length - 1)]
          patch(i, {
            sel: p.sel.includes(c.path) ? p.sel.filter((s) => s !== c.path) : [...p.sel, c.path],
            cursor: next.path,
            anchor: c.path,
          })
        }
        break
      }
      case 'F2': rename(i); break
      case 'F3': props(i); break
      case 'F4': edit(i); break
      case 'F5': transfer(false, i); break
      case 'F6': transfer(true, i); break
      case 'F7': newFolder(i); break
      default:
        if (meta && e.key.toLowerCase() === 'a') selectAll(i)
        else if (meta && e.key.toLowerCase() === 'r') refresh(i)
        else if (meta && e.key.toLowerCase() === 'f') search(i)
        else if (meta && e.key.toLowerCase() === 'i') props(i)
        else if (meta && e.shiftKey && e.key.toLowerCase() === 'n') newFolder(i)
        else if (meta && (e.key === '.' || e.key === '>')) patch(i, { showHidden: !p.showHidden })
        else handled = false
    }
    if (handled) e.preventDefault()
  }

  // close context menu on any click
  useEffect(() => {
    if (!ctx) return
    const close = () => setCtx(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [ctx])

  const ctl: PaneCtl = {
    hosts: data.hosts, places,
    activate: (i) => { setActiveIdx(i); rootRef.current?.focus() },
    setSource: openSource, go, up, back, refresh, click, open: openEntry,
    sort: (i, key) => {
      const p = panesRef.current[i]
      patch(i, { sortKey: key, sortDir: p.sortKey === key ? ((p.sortDir * -1) as 1 | -1) : 1 })
    },
    toggleHidden: (i) => patch(i, { showHidden: !panesRef.current[i].showHidden }),
    setFilter: (i, v) => patch(i, { filter: v }),
    newFolder, newFile, sync: syncFolders,
    context: (ev, i, entry) => {
      ev.preventDefault()
      setActiveIdx(i)
      const p = panesRef.current[i]
      if (entry && !p.sel.includes(entry.path)) patch(i, { sel: [entry.path], cursor: entry.path, anchor: entry.path })
      setCtx({ x: ev.clientX, y: ev.clientY, idx: i, entry })
    },
    dragStart: (i, e) => {
      const p = panesRef.current[i]
      const paths = p.sel.includes(e.path) ? p.sel : [e.path]
      if (!p.sel.includes(e.path)) patch(i, { sel: [e.path], cursor: e.path, anchor: e.path })
      dragRef.current = { from: i, paths }
    },
    dragging: () => !!dragRef.current,
    dragEnd: () => { dragRef.current = null },
    drop: (i, toDir, move) => {
      const d = dragRef.current
      dragRef.current = null
      if (!d) return
      if (d.from === i && !toDir) return
      transfer(move, d.from, { paths: d.paths, toDir: toDir ?? undefined, toPane: i })
    },
  }

  const ctxEntry = ctx?.entry ?? null
  const ctxPane = ctx ? panes[ctx.idx] : null

  return (
    <div className="fm" tabIndex={0} ref={rootRef} onKeyDown={onKey}>
      <div className="fm-panes">
        {[0, 1].map((i) => (
          <PaneView key={i} idx={i} p={panes[i]} active={activeIdx === i} ctl={ctl} />
        ))}
      </div>

      <div className="fm-keys">
        <button className="btn sm" onClick={() => rename(activeIdx)}><kbd>F2</kbd> {t('common.rename')}</button>
        <button className="btn sm" onClick={() => props(activeIdx)}><kbd>F3</kbd> {t('fm.info')}</button>
        <button className="btn sm" onClick={() => edit(activeIdx)}><kbd>F4</kbd> {t('fm.edit')}</button>
        <button className="btn sm primary" onClick={() => transfer(false, activeIdx)}><kbd>F5</kbd> {t('fm.copyToOtherPane')} →</button>
        <button className="btn sm" onClick={() => transfer(true, activeIdx)}><kbd>F6</kbd> {t('fm.moveToOtherPane')} →</button>
        <button className="btn sm" onClick={() => newFolder(activeIdx)}><kbd>F7</kbd> {t('fm.newFolder')}</button>
        <button className="btn sm danger" onClick={() => del(activeIdx)}><kbd>F8</kbd> {t('common.delete')}</button>
        <span className="grow" />
        <button className="btn sm ghost" onClick={() => search(activeIdx)}><Search size={13} /> {t('fm.search')}</button>
        <span className="faint" style={{ fontSize: 12 }}>{t('fm.tabSwitchHint')}</span>
      </div>

      <Transfers jobs={jobs} />

      {ctx && ctxPane && (
        <div className="menu" style={{ position: 'fixed', left: Math.min(ctx.x, window.innerWidth - 220), top: Math.min(ctx.y, window.innerHeight - 330) }}
          onClick={(e) => e.stopPropagation()}>
          {ctxEntry && <button onClick={() => { setCtx(null); openEntry(ctx.idx, ctxEntry) }}>{t('fm.open')}</button>}
          {ctxEntry && !ctxEntry.isDir && <button onClick={() => { setCtx(null); edit(ctx.idx) }}>{t('fm.editEllipsis')}</button>}
          {ctxEntry && <div className="sep" />}
          {ctxEntry && <button onClick={() => { setCtx(null); transfer(false, ctx.idx) }}>{t('fm.copyToOtherPane')}</button>}
          {ctxEntry && <button onClick={() => { setCtx(null); transfer(true, ctx.idx) }}>{t('fm.moveToOtherPane')}</button>}
          {ctxEntry && <button onClick={() => { setCtx(null); compress(ctx.idx) }}>{t('fm.compress')}</button>}
          {ctxEntry && !ctxEntry.isDir && ctxEntry.name.toLowerCase().endsWith('.zip') && (
            <button onClick={() => { setCtx(null); extractHere(ctx.idx) }}>{t('fm.extractHere')}</button>
          )}
          {ctxEntry && <button onClick={() => { setCtx(null); rename(ctx.idx) }}>{t('fm.renameEllipsis')}</button>}
          {ctxEntry && <button className="danger" onClick={() => { setCtx(null); del(ctx.idx) }}>{t('fm.deleteEllipsis')}</button>}
          <div className="sep" />
          <button onClick={() => { setCtx(null); newFolder(ctx.idx) }}>{t('fm.newFolderEllipsis')}</button>
          <button onClick={() => { setCtx(null); newFile(ctx.idx) }}>{t('fm.newFileEllipsis')}</button>
          {ctxEntry && <button onClick={() => { setCtx(null); props(ctx.idx) }}>{t('fm.propertiesEllipsis')}</button>}
          {ctxEntry && <button onClick={() => { navigator.clipboard?.writeText(ctxEntry.path); setCtx(null); toast(t('fm.pathCopied'), 'ok') }}>{t('fm.copyPath')}</button>}
          {ctxEntry && !ctxPane.hostId && (
            <button onClick={() => { setCtx(null); api.RevealPath(ctxEntry.path).catch(() => {}) }}>{t('fm.showInFinder')}</button>
          )}
          <div className="sep" />
          <button onClick={() => { setCtx(null); refresh(ctx.idx) }}>{t('fm.refresh')}</button>
        </div>
      )}

      {dlg?.kind === 'mkdir' && (
        <TextPrompt title={t('fm.newFolderTitle')} label={t('fm.folderName')} confirm={t('common.create')} onClose={() => setDlg(null)}
          onSubmit={async (name) => {
            try { await api.FsMkdir(dlg.fsId, joinPath(dlg.dir, name)); setDlg(null); refreshFs(dlg.fsId) }
            catch (e) { toast(errMsg(e), 'err') }
          }} />
      )}
      {dlg?.kind === 'compress' && (
        <TextPrompt title={t('fm.compress')} label={t('fm.archiveName')} initial={dlg.suggested} confirm={t('fm.createArchive')}
          onClose={() => setDlg(null)}
          onSubmit={(name) => {
            setDlg(null)
            const destZip = joinPath(dlg.dir, name.toLowerCase().endsWith('.zip') ? name : `${name}.zip`)
            api.FsArchive(dlg.fsId, dlg.paths, destZip).catch((e: any) => toast(errMsg(e), 'err'))
          }} />
      )}
      {dlg?.kind === 'newfile' && (
        <TextPrompt title={t('fm.newFileTitle')} label={t('fm.fileName')} confirm={t('common.create')} onClose={() => setDlg(null)}
          onSubmit={async (name) => {
            try { await api.FsNewFile(dlg.fsId, joinPath(dlg.dir, name)); setDlg(null); refreshFs(dlg.fsId) }
            catch (e) { toast(errMsg(e), 'err') }
          }} />
      )}
      {dlg?.kind === 'rename' && (
        <TextPrompt title={t('fm.renameTitle')} label={t('fm.newName')} initial={dlg.entry.name} confirm={t('common.rename')} onClose={() => setDlg(null)}
          onSubmit={async (name) => {
            if (name.includes('/')) { toast(t('fm.nameNoSlash'), 'err'); return }
            try {
              await api.FsRename(dlg.fsId, dlg.entry.path, joinPath(dirname(dlg.entry.path), name))
              setDlg(null); refreshFs(dlg.fsId)
            } catch (e) { toast(errMsg(e), 'err') }
          }} />
      )}
      {dlg?.kind === 'delete' && (
        <DeleteDialog dlg={dlg} onClose={() => setDlg(null)} onDone={() => refreshFs(dlg.fsId)} />
      )}
      {dlg?.kind === 'conflict' && (
        <Modal title={t('fm.conflictTitle')} onClose={() => setDlg(null)} width={460}
          footer={<>
            <button className="btn left" onClick={() => setDlg(null)}>{t('common.cancel')}</button>
            <button className="btn" onClick={() => { const r = dlg.run; setDlg(null); r('skip') }}>{t('fm.skipExisting')}</button>
            <button className="btn" onClick={() => { const r = dlg.run; setDlg(null); r('rename') }}>{t('fm.keepBoth')}</button>
            <button className="btn primary" onClick={() => { const r = dlg.run; setDlg(null); r('overwrite') }}>{t('fm.replace')}</button>
          </>}>
          <p style={{ marginTop: 0 }}>
            {dlg.names.length === 1
              ? t('fm.conflictOne', { name: dlg.names[0] })
              : t('fm.conflictMany', { n: dlg.names.length, name: dlg.names[0] })}
          </p>
          <p className="hint">{t('fm.conflictHint')}</p>
        </Modal>
      )}
      {dlg?.kind === 'props' && (
        <PropsDialog dlg={dlg} onClose={() => setDlg(null)} onDone={() => refreshFs(dlg.fsId)} />
      )}
      {dlg?.kind === 'edit' && <EditorDialog dlg={dlg} onClose={() => { setDlg(null); refreshFs(dlg.fsId) }} />}
      {dlg?.kind === 'search' && (
        <SearchDialog dlg={dlg} onClose={() => setDlg(null)}
          onPick={async (e: Entry) => {
            setDlg(null)
            const i = dlg.idx
            const dir = e.isDir ? e.path : dirname(e.path)
            await load(i, panesRef.current[i].fsId, dir, true, false)
            patch(i, { sel: [e.path], cursor: e.path, anchor: e.path })
          }} />
      )}
      {dlg?.kind === 'sync' && (
        <SyncDialog dlg={dlg} onClose={() => setDlg(null)} onDone={() => refreshFs(dlg.dstFs)} />
      )}
    </div>
  )
}

// ====================================================================== pane

interface PaneCtl {
  hosts: Host[]
  places: Place[]
  activate: (i: number) => void
  setSource: (i: number, hostId: string | null) => void
  go: (i: number, path: string) => void
  up: (i: number) => void
  back: (i: number) => void
  refresh: (i: number) => void
  click: (i: number, e: Entry, ev: React.MouseEvent) => void
  open: (i: number, e: Entry) => void
  sort: (i: number, key: PaneState['sortKey']) => void
  toggleHidden: (i: number) => void
  setFilter: (i: number, v: string) => void
  newFolder: (i: number) => void
  newFile: (i: number) => void
  sync: (i: number) => void
  context: (ev: React.MouseEvent, i: number, e: Entry | null) => void
  dragStart: (i: number, e: Entry) => void
  dragging: () => boolean
  dragEnd: () => void
  drop: (i: number, toDir: string | null, move: boolean) => void
}

function PaneView({ idx, p, active, ctl }: { idx: number; p: PaneState; active: boolean; ctl: PaneCtl }) {
  const { t, lang } = useI18n()
  const [pathInput, setPathInput] = useState(p.path)
  const [dropPath, setDropPath] = useState('')
  const [placesOpen, setPlacesOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setPathInput(p.path), [p.path])

  const vis = useMemo(() => visibleEntries(p), [p.entries, p.sortKey, p.sortDir, p.showHidden, p.filter])
  const sel = useMemo(() => new Set(p.sel), [p.sel])
  const selSize = useMemo(
    () => vis.filter((e) => sel.has(e.path) && !e.isDir).reduce((n, e) => n + e.size, 0),
    [vis, sel],
  )

  // Large directories (tens of thousands of entries) would otherwise put
  // that many rows in the DOM at once; only render what's actually visible.
  const rowVirtualizer = useVirtualizer({
    count: vis.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 26,
    overscan: 12,
  })

  useEffect(() => {
    if (!p.cursor) return
    const i = vis.findIndex((e) => e.path === p.cursor)
    if (i >= 0) rowVirtualizer.scrollToIndex(i, { align: 'auto' })
  }, [p.cursor])

  const places: Place[] = p.hostId
    ? [{ name: t('fm.home'), path: p.home }, { name: 'Root /', path: '/' }, { name: '/etc', path: '/etc' }, { name: '/var/log', path: '/var/log' }, { name: '/tmp', path: '/tmp' }]
    : ctl.places

  const sortBtn = (key: PaneState['sortKey'], label: string) => (
    <button onClick={() => ctl.sort(idx, key)}>
      {label}{p.sortKey === key ? (p.sortDir === 1 ? ' ▲' : ' ▼') : ''}
    </button>
  )

  return (
    <div className={`pane ${active ? 'active' : ''}`} onMouseDown={() => ctl.activate(idx)}>
      <div className="pane-head">
        <select className="input" value={p.hostId ?? ''} onChange={(e) => ctl.setSource(idx, e.target.value || null)}>
          <option value="">{t('shell.thisComputer')}</option>
          {[...ctl.hosts].sort((a, b) => a.label.localeCompare(b.label)).map((h) => (
            <option key={h.id} value={h.id}>{h.label}</option>
          ))}
        </select>
        <div className="toolbar-group">
          <button className="icon-btn" title={t('fm.back')} disabled={!p.history.length} onClick={() => ctl.back(idx)}><ArrowLeft size={15} /></button>
          <button className="icon-btn" title={t('fm.parentFolder')} disabled={!p.path || p.path === '/'} onClick={() => ctl.up(idx)}><ArrowUp size={15} /></button>
        </div>
        <input className="input grow" value={pathInput} spellCheck={false}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && pathInput.trim()) ctl.go(idx, pathInput.trim()); if (e.key === 'Escape') setPathInput(p.path) }} />
        <div style={{ position: 'relative' }}>
          <button className="icon-btn" title={t('fm.places')} onClick={() => setPlacesOpen((o) => !o)}><HardDrive size={15} /></button>
          {placesOpen && (
            <div className="menu" style={{ right: 0, top: 30 }} onMouseLeave={() => setPlacesOpen(false)}>
              {places.filter((x) => x.path).map((pl) => (
                <button key={pl.path + pl.name} onClick={() => { setPlacesOpen(false); ctl.go(idx, pl.path) }}>
                  <Folder size={14} /> {pl.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="pane-sub">
        <div className="toolbar-group">
          <button className="icon-btn" title={t('fm.refresh')} onClick={() => ctl.refresh(idx)}><RefreshCw size={14} /></button>
          <button className="icon-btn" title={t('fm.newFolder')} onClick={() => ctl.newFolder(idx)}><FolderPlus size={15} /></button>
          <button className="icon-btn" title={t('fm.newFile')} onClick={() => ctl.newFile(idx)}><FilePlus size={15} /></button>
          <button className="icon-btn" title={t('fm.syncWithOtherPane')} onClick={() => ctl.sync(idx)}><FolderSync size={15} /></button>
          <button className={`icon-btn ${p.showHidden ? 'on' : ''}`} title={t('fm.showHidden')} onClick={() => ctl.toggleHidden(idx)}>
            {p.showHidden ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>
        </div>
        <span className="grow" />
        <input className="input" placeholder={t('fm.filterPlaceholder')} value={p.filter} onChange={(e) => ctl.setFilter(idx, e.target.value)} />
      </div>

      <div className="ftable">
        <div className="fhead">
          {sortBtn('name', t('fm.name'))}
          <div style={{ textAlign: 'right' }}>{sortBtn('size', t('fm.size'))}</div>
          {sortBtn('modTime', t('fm.modified'))}
          {sortBtn('modeStr', t('fm.permissions'))}
        </div>
        <div
          className="frows" ref={listRef}
          onContextMenu={(ev) => ctl.context(ev, idx, null)}
          onDragOver={(ev) => { if (ctl.dragging()) ev.preventDefault() }}
          onDrop={(ev) => { ev.preventDefault(); setDropPath(''); ctl.drop(idx, null, ev.altKey) }}
        >
          {p.error && (
            <div className="pane-msg">
              <div className="err" style={{ marginBottom: 10 }}>{p.error}</div>
              <button className="btn" onClick={() => (p.fsId ? ctl.refresh(idx) : ctl.setSource(idx, p.hostId))}>
                {p.fsId ? t('fm.tryAgain') : t('fm.reconnect')}
              </button>
            </div>
          )}
          {p.loading && !p.error && !vis.length && <div className="pane-msg">{p.hostId && !p.fsId ? t('fm.connecting', { label: p.label }) : t('fm.loading')}</div>}
          {!p.loading && !p.error && !vis.length && <div className="pane-msg">{t('fm.folderEmpty')}</div>}
          {!p.error && vis.length > 0 && (
            <div style={{ position: 'relative', height: rowVirtualizer.getTotalSize() }}>
              {rowVirtualizer.getVirtualItems().map((vr) => {
                const e = vis[vr.index]
                return (
                  <div
                    key={e.path} data-path={e.path}
                    className={`frow ${vr.index % 2 ? 'odd' : ''} ${sel.has(e.path) ? 'sel' : ''} ${p.cursor === e.path ? 'cursor' : ''} ${e.name.startsWith('.') ? 'hid' : ''} ${dropPath === e.path ? 'drop' : ''}`}
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, height: vr.size, transform: `translateY(${vr.start}px)` }}
                    draggable
                    onDragStart={(ev) => { ctl.dragStart(idx, e); ev.dataTransfer.effectAllowed = 'copyMove'; ev.dataTransfer.setData('text/plain', 'shellbay') }}
                    onDragEnd={() => { ctl.dragEnd(); setDropPath('') }}
                    onDragOver={e.isDir ? (ev) => { if (ctl.dragging()) { ev.preventDefault(); ev.stopPropagation(); setDropPath(e.path) } } : undefined}
                    onDragLeave={() => setDropPath((d) => (d === e.path ? '' : d))}
                    onDrop={e.isDir ? (ev) => { ev.preventDefault(); ev.stopPropagation(); setDropPath(''); ctl.drop(idx, e.path, ev.altKey) } : undefined}
                    onClick={(ev) => ctl.click(idx, e, ev)}
                    onDoubleClick={() => ctl.open(idx, e)}
                    onContextMenu={(ev) => { ev.stopPropagation(); ctl.context(ev, idx, e) }}
                  >
                    <div className="nm">
                      {e.isDir ? <Folder size={15} color="var(--accent)" /> : <FileIcon size={15} color="var(--muted)" />}
                      <span className="ellipsis">{e.name}</span>
                      {e.isLink && <Link2 size={11} color="var(--muted)" />}
                    </div>
                    <div className="num">{e.isDir ? '' : fmtSize(e.size)}</div>
                    <div className="dt">{fmtDate(e.modTime, lang)}</div>
                    <div className="pm">{e.modeStr}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="pane-foot">
        <span>{t('fm.itemsCount', { n: vis.length })}</span>
        {p.sel.length > 0 && <span>{t('fm.selectedCount', { n: p.sel.length })}{selSize > 0 ? ` · ${fmtSize(selSize)}` : ''}</span>}
        <span className="grow" />
        <span className="ellipsis">{p.label}</span>
      </div>
    </div>
  )
}

// ====================================================================== transfers

function Transfers({ jobs }: { jobs: Job[] }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(true)
  if (!jobs.length) return null
  const list = [...jobs].reverse().slice(0, 30)
  const running = jobs.filter((j) => j.state === 'running' || j.state === 'planning' || j.state === 'queued').length
  return (
    <div className="xfers">
      <div className="xfers-head">
        <b style={{ color: 'var(--text)' }}>{t('fm.transfers')}</b>
        <span>{running ? t('fm.active', { n: running }) : t('fm.allDone')}</span>
        <span className="grow" />
        <button className="btn ghost sm" onClick={() => api.TransferClear()}>{t('fm.clearFinished')}</button>
        <button className="btn ghost sm" onClick={() => setOpen((o) => !o)}>{open ? t('fm.hide') : t('fm.show')}</button>
      </div>
      {open && list.map((j) => {
        const pct = j.total > 0 ? Math.min(100, (j.done / j.total) * 100) : j.state === 'done' ? 100 : 0
        const live = j.state === 'running' || j.state === 'planning' || j.state === 'queued'
        return (
          <div className="job" key={j.id}>
            <div className="ellipsis">
              <b>{j.title}</b>{' '}
              <span className="muted">
                {j.state === 'planning' ? t('fm.preparing') : j.state === 'queued' ? t('fm.waiting') : j.state === 'error' ? '' : j.state === 'canceled' ? t('fm.canceled')
                  : `${fmtSize(j.done)} / ${fmtSize(j.total)}${j.files > 1 ? t('fm.filesProgress', { done: j.filesDone, total: j.files }) : ''}`}
              </span>
              {j.state === 'error' && <span className="err"> {j.error}</span>}
              {j.state === 'running' && j.current && <span className="faint"> · {j.current}</span>}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <span className="muted">{live ? fmtSpeed(j.speed) : j.state === 'done' ? t('fm.done') : ''}</span>
              {!live && j.resumable && j.done > 0 && j.done < j.total && (j.state === 'error' || j.state === 'canceled') && (
                <button className="icon-btn" title={t('fm.resumeTooltip')}
                  onClick={() => api.FsResumeTransfer(j.id, j.srcFs, j.dstFs).catch((e: any) => toast(errMsg(e), 'err'))}>
                  <RefreshCw size={14} />
                </button>
              )}
              {live && <button className="icon-btn" title={t('fm.cancelTooltip')} onClick={() => api.TransferCancel(j.id)}><X size={14} /></button>}
            </div>
            <div className={`bar ${j.state}`}><i style={{ width: `${pct}%` }} /></div>
          </div>
        )
      })}
    </div>
  )
}

// ====================================================================== dialogs

function DeleteDialog({ dlg, onClose, onDone }: { dlg: any; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n()
  const [permanent, setPermanent] = useState(!dlg.local)
  const items: Entry[] = dlg.items
  const run = async () => {
    try {
      const paths = items.map((e) => e.path)
      if (dlg.local && !permanent) await api.FsTrash(paths)
      else await api.FsDelete(dlg.fsId, paths)
      onDone()
    } catch (e) {
      toast(errMsg(e), 'err')
      onDone()
    }
  }
  return (
    <Confirm title={permanent ? t('fm.deletePermanently') : t('fm.moveToTrash')} danger confirm={permanent ? t('common.delete') : t('fm.moveToTrash')} onClose={onClose} onConfirm={run}>
      <p style={{ marginTop: 0 }}>
        {items.length === 1 ? t('fm.deleteBodyOne', { name: items[0].name }) : t('fm.deleteBodyMany', { n: items.length })}
        {permanent ? t('fm.deleteSuffixPermanent') : t('fm.deleteSuffixTrash')}
      </p>
      {dlg.local && (
        <label className="check">
          <input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} />
          {t('fm.deletePermanentlyCheckbox')}
        </label>
      )}
      {!dlg.local && <p className="hint">{t('fm.noTrashRemote')}</p>}
    </Confirm>
  )
}

function PropsDialog({ dlg, onClose, onDone }: { dlg: any; onClose: () => void; onDone: () => void }) {
  const { t, lang } = useI18n()
  const e: Entry = dlg.entry
  const [mode, setMode] = useState((e.mode & 0o777).toString(8).padStart(3, '0'))
  const [recursive, setRecursive] = useState(false)
  const [size, setSize] = useState<null | { bytes: number; files: number; dirs: number }>(null)
  useEffect(() => {
    if (e.isDir) api.FsSize(dlg.fsId, e.path).then(setSize).catch(() => {})
  }, [])
  const apply = async () => {
    const m = parseInt(mode, 8)
    if (Number.isNaN(m) || !/^[0-7]{3,4}$/.test(mode)) { toast(t('fm.permissionsMustBeOctal'), 'err'); return }
    try {
      await api.FsChmod(dlg.fsId, e.path, m, recursive)
      toast(t('fm.permissionsUpdated'), 'ok')
      onDone(); onClose()
    } catch (err) { toast(errMsg(err), 'err') }
  }
  return (
    <Modal title={e.name} onClose={onClose} width={460}
      footer={<><button className="btn" onClick={onClose}>{t('common.close')}</button><button className="btn primary" onClick={apply}>{t('fm.applyPermissions')}</button></>}>
      <div className="code" style={{ marginBottom: 12 }}>{e.path}</div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="field"><label>{t('fm.kind')}</label><div>{e.isDir ? t('fm.folder') : e.isLink ? t('fm.link') : t('fm.file')}</div></div>
        <div className="field"><label>{t('fm.size')}</label><div>
          {e.isDir
            ? (size ? t('fm.sizeSummary', { size: fmtSize(size.bytes), files: size.files, dirs: Math.max(0, size.dirs - 1) }) : t('fm.calculating'))
            : t('fm.sizeBytes', { size: fmtSize(e.size), bytes: e.size.toLocaleString() })}
        </div></div>
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="field"><label>{t('fm.modified')}</label><div>{e.modTime ? new Date(e.modTime).toLocaleString(lang) : '—'}</div></div>
        <div className="field"><label>{t('fm.owner')}</label><div>{e.owner || '—'}</div></div>
      </div>
      <Field label={t('fm.permissionsOctal')} hint={t('fm.currentlyMode', { mode: e.modeStr })}>
        <input className="input mono" style={{ width: 120 }} value={mode} onChange={(ev) => setMode(ev.target.value)} />
      </Field>
      {e.isDir && (
        <label className="check">
          <input type="checkbox" checked={recursive} onChange={(ev) => setRecursive(ev.target.checked)} />
          {t('fm.applyToEverythingInside')}
        </label>
      )}
    </Modal>
  )
}

function EditorDialog({ dlg, onClose }: { dlg: any; onClose: () => void }) {
  const { t } = useI18n()
  const [text, setText] = useState<string | null>(null)
  const [orig, setOrig] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [lang, setLang] = useState<LanguageId>(() => detectLanguage(dlg.path))
  useEffect(() => {
    api.FsReadText(dlg.fsId, dlg.path).then((txt: string) => { setText(txt); setOrig(txt) }).catch((e) => setErr(errMsg(e)))
  }, [])
  const dirty = text !== null && text !== orig
  const save = async () => {
    if (text === null) return
    setSaving(true)
    try { await api.FsWriteText(dlg.fsId, dlg.path, text); setOrig(text); toast(t('fm.saved'), 'ok') }
    catch (e) { toast(errMsg(e), 'err') }
    finally { setSaving(false) }
  }
  const close = () => {
    if (dirty && !window.confirm(t('fm.closeWithoutSaving'))) return
    onClose()
  }
  return (
    <Modal title={`${basename(dlg.path)}${dirty ? ' •' : ''}`} onClose={close} width={1100} height={640} maximizable
      headExtra={
        <select className="input sm" style={{ width: 170 }} value={lang} onChange={(e) => setLang(e.target.value as LanguageId)}>
          {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      }
      footer={<>
        <span className="muted left ellipsis" style={{ maxWidth: 440 }}>{dlg.path}</span>
        <button className="btn" onClick={close}>{t('common.close')}</button>
        <button className="btn primary" disabled={!dirty || saving} onClick={save}>{t('common.save')}</button>
      </>}>
      {err && <div className="banner danger">{err}</div>}
      {text === null && !err && <div className="muted">{t('fm.loading')}</div>}
      {text !== null && (
        <div className="editor-shell">
          <CodeEditor value={text} onChange={setText} languageId={lang} onSave={save} />
        </div>
      )}
    </Modal>
  )
}

function SearchDialog({ dlg, onClose, onPick }: { dlg: any; onClose: () => void; onPick: (e: Entry) => void }) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Entry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!q.trim()) return
    setBusy(true)
    try { setRes(await api.FsSearch(dlg.fsId, dlg.root, q)) }
    catch (e) { toast(errMsg(e), 'err') }
    finally { setBusy(false) }
  }
  return (
    <Modal title={t('fm.searchByName')} onClose={onClose} width={620}
      footer={<><span className="muted left">{t('fm.searchingIn', { root: dlg.root })}</span><button className="btn" onClick={onClose}>{t('common.close')}</button></>}>
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="input" autoFocus placeholder={t('fm.searchPlaceholder')} value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run() }} />
        <button className="btn primary" onClick={run} disabled={busy}>{busy ? t('fm.searching') : t('fm.search')}</button>
      </div>
      {res && res.length === 0 && <div className="muted">{t('fm.noResults')}</div>}
      {res && res.length > 0 && (
        <div className="results">
          {res.map((e) => (
            <button key={e.path} onClick={() => onPick(e)}>
              {e.isDir ? <Folder size={14} color="var(--accent)" /> : <FileIcon size={14} color="var(--muted)" />}
              <span className="ellipsis">{e.path.startsWith(dlg.root) ? e.path.slice(dlg.root.length).replace(/^\//, '') || e.name : e.path}</span>
              <span className="grow" />
              <span className="muted">{e.isDir ? '' : fmtSize(e.size)}</span>
            </button>
          ))}
          {res.length >= 500 && <div className="muted" style={{ padding: 8 }}>{t('fm.first500')}</div>}
        </div>
      )}
    </Modal>
  )
}
