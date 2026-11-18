import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, Search, Trash2, Pencil, Star, MoreHorizontal, Send, FolderOpen, Copy, ChevronDown, Signal, List, LayoutGrid,
} from 'lucide-react'
import { TextPrompt, Confirm } from './Modal'
import HostDetailsPanel from './HostDetailsPanel'
import OsIcon from './OsIcon'
import { api, errMsg } from '../api'
import { toast } from '../toast'
import { initials } from '../util'
import { useI18n } from '../i18n'
import type { Host, PingResult, VaultData } from '../types'

interface Props {
  data: VaultData
  reload: () => void
  onConnect: (h: Host) => void
  onSftp: (h: Host) => void
  pendingNewHost: Partial<Host> | null
  onPendingNewHostHandled: () => void
}

export default function HostsView({ data, reload, onConnect, onSftp, pendingNewHost, onPendingNewHostHandled }: Props) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<string>('all')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [dlg, setDlg] = useState<null | 'new' | 'rename' | 'delete'>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<Host> | null>(null)
  const dragHostId = useRef<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [delHost, setDelHost] = useState<Host | null>(null)
  const [favOpen, setFavOpen] = useState(true)
  const [allOpen, setAllOpen] = useState(true)
  const [pings, setPings] = useState<Record<string, PingResult>>({})
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    try { return (localStorage.getItem('shellbay_hosts_view') ?? localStorage.getItem('harbor_hosts_view')) === 'grid' ? 'grid' : 'list' } catch { return 'list' }
  })
  const setMode = (m: 'list' | 'grid') => {
    setViewMode(m)
    try { localStorage.setItem('shellbay_hosts_view', m) } catch { /* ignore */ }
  }

  // Lightweight reachability probe for the status dot/latency shown per row.
  // Keyed on the set of host ids (not the filtered/search view), so typing
  // in the search box doesn't restart it, and re-runs periodically so a host
  // that comes back online updates without the user reloading.
  const hostIds = data.hosts.map((h) => h.id).join(',')
  useEffect(() => {
    let cancelled = false
    const pingAll = () => {
      for (const h of data.hosts) {
        if (!h.id) continue
        api.PingHost(h.id).then((r: PingResult) => {
          if (!cancelled) setPings((s) => ({ ...s, [h.id]: r }))
        }).catch(() => {})
      }
    }
    pingAll()
    const iv = setInterval(pingAll, 25000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [hostIds])

  useEffect(() => {
    if (pendingNewHost) {
      setDraft(pendingNewHost)
      setSelectedId(null)
      onPendingNewHostHandled()
    }
  }, [pendingNewHost])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return data.hosts
      .filter((h) => (group === 'all' ? true : group === 'none' ? !h.groupId : h.groupId === group))
      .filter((h) => !tagFilter || h.tags.includes(tagFilter))
      .filter((h) => !s || [h.label, h.address, h.username, ...(h.tags ?? [])].join(' ').toLowerCase().includes(s))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [data.hosts, q, group, tagFilter])

  const recent = useMemo(() => {
    if (q || group !== 'all' || tagFilter) return []
    return [...data.hosts].filter((h) => h.lastUsedAt > 0).sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, 4)
  }, [data.hosts, q, group, tagFilter])

  const favorites = useMemo(() => filtered.filter((h) => h.favorite), [filtered])

  const allTags = useMemo(() => Array.from(new Set(data.hosts.flatMap((h) => h.tags ?? []))).sort(), [data.hosts])

  const currentGroup = data.groups.find((g) => g.id === group)

  const select = (h: Host) => { setSelectedId(h.id); setDraft(null) }
  const startNew = () => { setDraft({}); setSelectedId(null) }
  const startDuplicate = (h: Partial<Host>) => { setDraft(h); setSelectedId(null) }
  const closePanel = () => { setSelectedId(null); setDraft(null) }

  const toggleFavorite = async (h: Host) => {
    try { await api.SaveHost({ ...h, favorite: !h.favorite }); reload() }
    catch (e) { toast(errMsg(e), 'err') }
  }

  const removeHost = async (h: Host) => {
    try {
      await api.DeleteHost(h.id)
      if (selectedId === h.id) closePanel()
      setDelHost(null)
      reload()
    } catch (e) { toast(errMsg(e), 'err') }
  }

  const dropOnGroup = async (groupId: string) => {
    const id = dragHostId.current
    dragHostId.current = null
    const h = data.hosts.find((x) => x.id === id)
    if (!h || h.groupId === groupId) return
    try { await api.SaveHost({ ...h, groupId }); reload() }
    catch (e) { toast(errMsg(e), 'err') }
  }

  const card = (h: Host) => {
    const ping = pings[h.id]
    return (
      <div key={h.id} className={`host ${selectedId === h.id ? 'sel' : ''}`}
        style={menuFor === h.id ? { zIndex: 20 } : undefined}
        draggable
        onDragStart={() => { dragHostId.current = h.id }}
        onClick={() => select(h)}
        onDoubleClick={() => (h.protocol === 'ftp' ? onSftp(h) : onConnect(h))}>
        <div style={{ position: 'relative', flex: 'none' }}>
          <div className="badge" style={{ background: h.color || 'var(--accent)' }}>{initials(h.label)}</div>
          <span style={{ position: 'absolute', right: -3, bottom: -3, background: 'var(--panel)', borderRadius: 99, padding: 1, color: 'var(--muted)' }}>
            <OsIcon os={h.os} />
          </span>
        </div>
        <div className="grow">
          <div className="name ellipsis">{h.label}</div>
          <div className="meta ellipsis">
            {h.protocol === 'ftp' ? 'FTP · ' : ''}{h.username || '—'}@{h.address}{h.port !== 22 ? `:${h.port}` : ''}
          </div>
          {h.tags?.length > 0 && <div style={{ marginTop: 3 }}>{h.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>}
        </div>
        <div className="host-actions" onClick={(e) => e.stopPropagation()}>
          <span className={`host-status ${ping ? (ping.reachable ? 'ok' : 'off') : ''}`}>
            <span className="host-status-dot" />
            {ping ? (ping.reachable ? t('hosts.online') : t('hosts.offline')) : ''}
          </span>
          {ping?.reachable && <span className="host-latency"><Signal size={12} /> {ping.ms} ms</span>}
          <button className={`icon-btn star ${h.favorite ? 'on' : ''}`} title={h.favorite ? t('hosts.unfavorite') : t('hosts.favorite')}
            onClick={() => toggleFavorite(h)}>
            <Star size={14} fill={h.favorite ? 'currentColor' : 'none'} />
          </button>
          <div style={{ position: 'relative' }}>
            <button className="icon-btn" onClick={() => setMenuFor((m) => (m === h.id ? null : h.id))}><MoreHorizontal size={14} /></button>
            {menuFor === h.id && (
              <div className="menu" style={{ right: 0, top: 26 }} onMouseLeave={() => setMenuFor(null)} onClick={() => setMenuFor(null)}>
                <button onClick={() => (h.protocol === 'ftp' ? onSftp(h) : onConnect(h))}><Send size={14} /> {t('hosts.connect')}</button>
                {h.protocol !== 'ftp' && <button onClick={() => onSftp(h)}><FolderOpen size={14} /> {t('hosts.openFileManager')}</button>}
                <button onClick={() => startDuplicate({ ...h, id: '', label: `${h.label} copy` })}><Copy size={14} /> {t('hosts.duplicate')}</button>
                <button className="danger" onClick={() => setDelHost(h)}><Trash2 size={14} /> {t('common.delete')}</button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  const section = (titleKey: string, count: number, open: boolean, setOpen: (v: boolean) => void, hosts: Host[]) => (
    <>
      <button className="accordion-head" onClick={() => setOpen(!open)}>
        <ChevronDown size={14} className={`accordion-chevron ${open ? '' : 'collapsed'}`} />
        <span>{t(titleKey)}</span>
        <span className="accordion-count">{count}</span>
      </button>
      <div className={`accordion-body ${open ? '' : 'collapsed'}`}>
        <div className={`host-grid ${viewMode === 'grid' ? 'grid-mode' : ''}`}>{hosts.map(card)}</div>
      </div>
    </>
  )

  const selectedHost = draft ?? data.hosts.find((h) => h.id === selectedId) ?? null

  return (
    <div className="hosts-shell">
      <div className="view" style={{ flex: 1, minWidth: 0 }}>
        <div className="page-head">
          <h1>{t('hosts.title')}</h1>
          <span className="sub">{t('hosts.savedCount', { n: data.hosts.length })}</span>
        </div>
        <div className="toolbar">
          <div className="search">
            <Search size={15} />
            <input className="input" placeholder={t('hosts.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="toolbar-group">
            <button className={`icon-btn ${viewMode === 'list' ? 'on' : ''}`} title={t('hosts.viewList')} onClick={() => setMode('list')}>
              <List size={15} />
            </button>
            <button className={`icon-btn ${viewMode === 'grid' ? 'on' : ''}`} title={t('hosts.viewGrid')} onClick={() => setMode('grid')}>
              <LayoutGrid size={15} />
            </button>
          </div>
          <button className="btn primary" onClick={startNew}><Plus size={15} /> {t('hosts.newHost')}</button>
          <button className="btn" onClick={() => setDlg('new')}>{t('hosts.newGroup')}</button>
        </div>

        <div className="chips">
          <button className={`chip ${group === 'all' ? 'on' : ''}`} onClick={() => setGroup('all')}>{t('hosts.all')}</button>
          {data.groups.map((g) => (
            <button key={g.id} className={`chip ${group === g.id ? 'on' : ''}`} onClick={() => setGroup(g.id)}
              onDragOver={(e) => e.preventDefault()} onDrop={() => dropOnGroup(g.id)}>
              {g.name} <span className="faint">{data.hosts.filter((h) => h.groupId === g.id).length}</span>
            </button>
          ))}
          {data.groups.length > 0 && (
            <button className={`chip ${group === 'none' ? 'on' : ''}`} onClick={() => setGroup('none')}
              onDragOver={(e) => e.preventDefault()} onDrop={() => dropOnGroup('')}>{t('hosts.ungrouped')}</button>
          )}
          {currentGroup && (
            <>
              <button className="btn ghost sm" onClick={() => setDlg('rename')}><Pencil size={13} /> {t('hosts.rename')}</button>
              <button className="btn ghost sm" onClick={() => setDlg('delete')}><Trash2 size={13} /> {t('hosts.deleteGroup')}</button>
            </>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="chips" title={t('hosts.tagFilterHint')}>
            {allTags.map((tag) => (
              <button key={tag} className={`chip tag-chip-filter ${tagFilter === tag ? 'on' : ''}`}
                onClick={() => setTagFilter((cur) => (cur === tag ? null : tag))}>{tag}</button>
            ))}
          </div>
        )}

        {data.hosts.length === 0 && (
          <div className="empty">
            <h3>{t('hosts.emptyTitle')}</h3>
            <p>{t('hosts.emptyBody')}</p>
            <button className="btn primary" onClick={startNew}><Plus size={15} /> {t('hosts.newHost')}</button>
          </div>
        )}

        {recent.length > 0 && (
          <>
            <div className="section-title">{t('hosts.recent')}</div>
            <div className={`host-grid ${viewMode === 'grid' ? 'grid-mode' : ''}`}>{recent.map(card)}</div>
          </>
        )}
        {favorites.length > 0 && section('hosts.favorites', favorites.length, favOpen, setFavOpen, favorites)}
        {filtered.length > 0 && section('hosts.allHosts', filtered.length, allOpen, setAllOpen, filtered)}
        {data.hosts.length > 0 && filtered.length === 0 && <div className="empty">{t('hosts.noMatches', { q })}</div>}

        {delHost && (
          <Confirm title={t('hosts.deleteHostTitle')} danger confirm={t('hosts.deleteHostConfirm')} onClose={() => setDelHost(null)}
            onConfirm={() => removeHost(delHost)}>
            <p style={{ marginTop: 0 }}>{t('hosts.deleteHostBody', { name: delHost.label })}</p>
          </Confirm>
        )}

        {dlg === 'new' && (
          <TextPrompt title={t('hosts.newGroup')} label={t('hosts.groupName')} confirm={t('common.create')} onClose={() => setDlg(null)}
            onSubmit={async (name) => {
              try { const g = await api.SaveGroup({ id: '', name }); setGroup(g.id); reload(); setDlg(null) }
              catch (e) { toast(errMsg(e), 'err') }
            }} />
        )}
        {dlg === 'rename' && currentGroup && (
          <TextPrompt title={t('hosts.renameGroupTitle')} label={t('hosts.groupName')} initial={currentGroup.name} confirm={t('common.rename')} onClose={() => setDlg(null)}
            onSubmit={async (name) => {
              try { await api.SaveGroup({ id: currentGroup.id, name }); reload(); setDlg(null) }
              catch (e) { toast(errMsg(e), 'err') }
            }} />
        )}
        {dlg === 'delete' && currentGroup && (
          <Confirm title={t('hosts.deleteGroupTitle')} danger confirm={t('hosts.deleteGroupConfirm')} onClose={() => setDlg(null)}
            onConfirm={async () => { await api.DeleteGroup(currentGroup.id); setGroup('all'); reload() }}>
            <p style={{ marginTop: 0 }}>{t('hosts.deleteGroupBody', { name: currentGroup.name })}</p>
          </Confirm>
        )}
      </div>

      {selectedHost && (
        <HostDetailsPanel
          key={selectedHost.id || 'new'}
          host={selectedHost}
          data={data}
          reload={reload}
          onClose={closePanel}
          onConnect={onConnect}
          onSftp={onSftp}
          onDuplicate={startDuplicate}
        />
      )}
    </div>
  )
}
