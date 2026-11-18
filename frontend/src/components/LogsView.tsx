import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, FileText, FolderOpen, RefreshCw, Trash2 } from 'lucide-react'
import Modal, { Confirm } from './Modal'
import { api, errMsg } from '../api'
import { toast } from '../toast'
import { fmtDate, fmtSize } from '../util'
import { useI18n } from '../i18n'
import type { LogInfo } from '../types'

export default function LogsView() {
  const { t, lang } = useI18n()
  const [logs, setLogs] = useState<LogInfo[] | null>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<LogInfo | null>(null)
  const [del, setDel] = useState<LogInfo | null>(null)

  const refresh = () => { api.LogList().then(setLogs).catch((e) => toast(errMsg(e), 'err')) }
  useEffect(refresh, [])

  const filtered = useMemo(() => {
    if (!logs) return []
    const s = q.trim().toLowerCase()
    return logs.filter((l) => !s || l.label.toLowerCase().includes(s))
  }, [logs, q])

  const remove = async () => {
    if (!del) return
    try { await api.LogDelete(del.name); setDel(null); refresh() }
    catch (e) { toast(errMsg(e), 'err') }
  }

  return (
    <div className="view">
      <div className="page-head">
        <h1>{t('logs.title')}</h1>
        <span className="grow" />
        <input className="input" style={{ width: 240 }} placeholder={t('logs.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="icon-btn" title={t('fm.refresh')} onClick={refresh}><RefreshCw size={15} /></button>
      </div>
      {logs === null && <div className="muted">{t('fm.loading')}</div>}
      {logs !== null && filtered.length === 0 && <div className="muted">{t('logs.empty')}</div>}
      {filtered.map((l) => (
        <div key={l.name} className="log-row" onClick={() => setOpen(l)}>
          <FileText size={15} className="faint" />
          <div className="grow">
            <div className="ellipsis">{l.label}</div>
            <div className="muted" style={{ fontSize: 12 }}>{fmtDate(l.modTime, lang)} · {fmtSize(l.size)}</div>
          </div>
          <button className="icon-btn" title={t('logs.reveal')} onClick={(e) => { e.stopPropagation(); api.LogReveal(l.name).catch(() => {}) }}>
            <FolderOpen size={14} />
          </button>
          <button className="icon-btn" title={t('common.delete')} onClick={(e) => { e.stopPropagation(); setDel(l) }}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      {open && <LogViewer info={open} onClose={() => setOpen(null)} />}
      {del && (
        <Confirm title={t('common.delete')} danger confirm={t('common.delete')} onClose={() => setDel(null)} onConfirm={remove}>
          <p style={{ marginTop: 0 }}>{t('logs.deleteConfirm')}</p>
        </Confirm>
      )}
    </div>
  )
}

function LogViewer({ info, onClose }: { info: LogInfo; onClose: () => void }) {
  const { t } = useI18n()
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [find, setFind] = useState('')
  const [matchIdx, setMatchIdx] = useState(0)

  useEffect(() => {
    api.LogRead(info.name).then(setText).catch((e) => setErr(errMsg(e)))
  }, [info.name])

  const matches = useMemo(() => {
    if (!text || !find.trim()) return [] as number[]
    const needle = find.toLowerCase()
    const hay = text.toLowerCase()
    const out: number[] = []
    let i = hay.indexOf(needle)
    while (i >= 0 && out.length < 500) { out.push(i); i = hay.indexOf(needle, i + needle.length) }
    return out
  }, [text, find])

  useEffect(() => { setMatchIdx(0) }, [find])

  const jump = (dir: 1 | -1) => {
    if (!matches.length) return
    const next = (matchIdx + dir + matches.length) % matches.length
    setMatchIdx(next)
    document.getElementById(`log-match-${next}`)?.scrollIntoView({ block: 'center' })
  }

  const rendered = useMemo(() => {
    if (!text) return null
    if (!find.trim() || matches.length === 0) return text
    const parts: (string | JSX.Element)[] = []
    let last = 0
    matches.forEach((idx, i) => {
      parts.push(text.slice(last, idx))
      parts.push(<mark key={i} id={`log-match-${i}`} className={i === matchIdx ? 'on' : ''}>{text.slice(idx, idx + find.length)}</mark>)
      last = idx + find.length
    })
    parts.push(text.slice(last))
    return parts
  }, [text, find, matches, matchIdx])

  return (
    <Modal title={info.label} onClose={onClose} width={900} height={620} maximizable
      headExtra={
        <div className="row" style={{ gap: 4 }}>
          <input className="input sm" style={{ width: 180 }} placeholder={t('logs.findPlaceholder')} value={find}
            onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') jump(e.shiftKey ? -1 : 1) }} />
          <button className="icon-btn" disabled={!matches.length} onClick={() => jump(-1)}><ChevronUp size={14} /></button>
          <button className="icon-btn" disabled={!matches.length} onClick={() => jump(1)}><ChevronDown size={14} /></button>
          {find.trim() && <span className="muted" style={{ fontSize: 12 }}>{matches.length ? `${matchIdx + 1}/${matches.length}` : t('logs.noMatches')}</span>}
        </div>
      }
      footer={<button className="btn" onClick={onClose}>{t('common.close')}</button>}>
      {err && <div className="banner danger">{err}</div>}
      {text === null && !err && <div className="muted">{t('fm.loading')}</div>}
      {text !== null && <pre className="log-view">{rendered}</pre>}
    </Modal>
  )
}
