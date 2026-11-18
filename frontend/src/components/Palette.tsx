import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, Plus, Terminal as TermIcon } from 'lucide-react'
import { initials } from '../util'
import { useI18n } from '../i18n'
import type { Host, VaultData } from '../types'

interface Props {
  data: VaultData
  onClose: () => void
  onTerminal: (h: Host) => void
  onSftp: (h: Host) => void
  onLocalTerminal: () => void
  onLocalFiles: () => void
  onNewHost: (h: Partial<Host>) => void
}

type Item = { key: string; icon: any; title: string; sub?: string; color?: string; run: (alt: boolean) => void }

export default function Palette({ data, onClose, onTerminal, onSftp, onLocalTerminal, onLocalFiles, onNewHost }: Props) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)

  const items = useMemo<Item[]>(() => {
    const s = q.trim().toLowerCase()
    const out: Item[] = []
    const quick = q.trim().match(/^(?:([\w.-]+)@)?([\w.-]+)(?::(\d+))?$/)
    data.hosts
      .filter((h) => !s || [h.label, h.address, h.username, ...(h.tags ?? [])].join(' ').toLowerCase().includes(s))
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt || a.label.localeCompare(b.label))
      .slice(0, 8)
      .forEach((h) => out.push({
        key: h.id, icon: null, title: h.label, sub: `${h.username}@${h.address}`, color: h.color,
        run: (alt) => (alt || h.protocol === 'ftp' ? onSftp(h) : onTerminal(h)),
      }))
    const newLocalTerminal = t('pal.newLocalTerminal')
    const openFileManager = t('pal.openFileManager')
    if ('local terminal'.includes(s) || 'this mac'.includes(s) || newLocalTerminal.toLowerCase().includes(s)) {
      out.push({ key: 'lt', icon: TermIcon, title: newLocalTerminal, run: () => onLocalTerminal() })
    }
    if ('files'.includes(s) || 'file manager'.includes(s) || openFileManager.toLowerCase().includes(s)) {
      out.push({ key: 'lf', icon: FolderOpen, title: openFileManager, run: () => onLocalFiles() })
    }
    if (quick && s && !out.some((o) => o.sub === q.trim())) {
      out.push({
        key: 'quick', icon: Plus, title: t('pal.addAsHost', { q: q.trim() }), run: () =>
          onNewHost({ username: quick[1] ?? '', address: quick[2], port: quick[3] ? Number(quick[3]) : 22 }),
      })
    }
    return out
  }, [q, data.hosts, t])

  useEffect(() => setIdx(0), [q])

  const choose = (i: number, alt: boolean) => { const it = items[i]; if (it) { onClose(); it.run(alt) } }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal palette" style={{ padding: 12 }}>
        <input
          className="input" autoFocus placeholder={t('pal.placeholder')}
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
            if (e.key === 'Enter') choose(idx, e.metaKey || e.altKey)
          }}
        />
        <div className="pal-list">
          {items.map((it, i) => (
            <div key={it.key} className={`pal-item ${i === idx ? 'on' : ''}`} onMouseEnter={() => setIdx(i)} onClick={(e) => choose(i, e.metaKey || e.altKey)}>
              {it.icon ? <it.icon size={18} color="var(--muted)" /> : (
                <div className="badge" style={{ background: it.color || 'var(--accent)', width: 26, height: 26, fontSize: 11, borderRadius: 7 }}>{initials(it.title)}</div>
              )}
              <div className="grow"><div>{it.title}</div>{it.sub && <div className="muted" style={{ fontSize: 12 }}>{it.sub}</div>}</div>
            </div>
          ))}
          {items.length === 0 && <div className="muted" style={{ padding: 10 }}>{t('shell.noMatches')}</div>}
        </div>
        <div className="hint" style={{ padding: '8px 4px 0' }}>{t('pal.hint')}</div>
      </div>
    </div>
  )
}
