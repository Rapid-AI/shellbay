import { useEffect, useMemo, useState } from 'react'
import { LayoutGrid } from 'lucide-react'
import { useI18n } from '../i18n'
import type { Tab } from '../types'

interface Item { key: string; title: string; color?: string }

interface Props {
  tabs: Tab[]
  onClose: () => void
  onJump: (key: string) => void
}

export default function TabSwitcher({ tabs, onClose, onJump }: Props) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [{ key: 'vaults', title: t('shell.vaultsTitle') }, ...tabs.map((tb) => ({ key: tb.id, title: tb.title, color: tb.color }))]
    const s = q.trim().toLowerCase()
    return s ? all.filter((it) => it.title.toLowerCase().includes(s)) : all
  }, [q, tabs, t])

  useEffect(() => setIdx(0), [q])

  const choose = (i: number) => { const it = items[i]; if (it) { onClose(); onJump(it.key) } }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal palette" style={{ padding: 12 }}>
        <input
          className="input" autoFocus placeholder={t('shell.jumpToTab')}
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
            if (e.key === 'Enter') choose(idx)
          }}
        />
        <div className="pal-list">
          {items.map((it, i) => (
            <div key={it.key} className={`pal-item ${i === idx ? 'on' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => choose(i)}>
              {it.key === 'vaults' ? <LayoutGrid size={18} color="var(--muted)" /> : (
                <span className="dot" style={{ background: it.color || 'var(--accent)' }} />
              )}
              <div className="grow">{it.title}</div>
            </div>
          ))}
          {items.length === 0 && <div className="muted" style={{ padding: 10 }}>{t('shell.noMatches')}</div>}
        </div>
        <div className="hint" style={{ padding: '8px 4px 0' }}>{t('shell.switchHint')}</div>
      </div>
    </div>
  )
}
