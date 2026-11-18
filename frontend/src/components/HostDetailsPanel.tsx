import { useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, FolderOpen, MoreHorizontal, Send, SquareTerminal, Trash2, Users, X } from 'lucide-react'
import { Confirm, Field } from './Modal'
import TagInput from './TagInput'
import { api, errMsg } from '../api'
import { toast } from '../toast'
import { HOST_COLORS } from '../util'
import { emptySelection } from './SelectionPicker'
import { useI18n } from '../i18n'
import type { Host, Peer, VaultData } from '../types'

interface Props {
  host: Partial<Host>
  data: VaultData
  reload: () => void
  onClose: () => void
  onConnect: (h: Host) => void
  onSftp: (h: Host) => void
  onDuplicate: (h: Partial<Host>) => void
}

export default function HostDetailsPanel({ host, data, reload, onClose, onConnect, onSftp, onDuplicate }: Props) {
  const { t } = useI18n()
  const [h, setH] = useState<Partial<Host>>({
    port: 22, authType: 'password', protocol: 'ssh', tags: [], color: HOST_COLORS[0], ...host,
  })
  const idRef = useRef(host.id ?? '')
  const [reveal, setReveal] = useState(false)
  const [more, setMore] = useState(false)
  const [menu, setMenu] = useState(false)
  const [del, setDel] = useState(false)
  const [share, setShare] = useState(false)
  const isNew = !idRef.current

  const set = (p: Partial<Host>) => setH((x) => ({ ...x, ...p }))

  const commit = async (patch: Partial<Host> = {}) => {
    const next = { ...h, ...patch }
    setH(next)
    if (!next.address || !next.address.trim()) return
    try {
      const saved = await api.SaveHost({ ...next, id: idRef.current })
      idRef.current = saved.id
      setH(saved)
      reload()
    } catch (e) {
      toast(errMsg(e), 'err')
    }
  }

  const remove = async () => {
    if (!idRef.current) { onClose(); return }
    try { await api.DeleteHost(idRef.current); reload(); onClose() }
    catch (e) { toast(errMsg(e), 'err') }
  }

  const others = data.hosts.filter((x) => x.id !== idRef.current)
  const canConnect = !isNew && !!h.address

  return (
    <div className="host-panel">
      <div className="host-panel-head">
        <b className="grow ellipsis">{h.label || t('hostEditor.newHost')}</b>
        {!isNew && (
          <button className="icon-btn" title={t('hosts.openFileManager')} onClick={() => onSftp(h as Host)}><FolderOpen size={15} /></button>
        )}
        <div style={{ position: 'relative' }}>
          <button className="icon-btn" onClick={() => setMenu((m) => !m)}><MoreHorizontal size={16} /></button>
          {menu && (
            <div className="menu" style={{ right: 0, top: 30 }} onMouseLeave={() => setMenu(false)} onClick={() => setMenu(false)}>
              <button onClick={() => onDuplicate({ ...h, id: '', label: `${h.label} copy` })}><Copy size={14} /> {t('hosts.duplicate')}</button>
              {!isNew && <button className="danger" onClick={() => setDel(true)}><Trash2 size={14} /> {t('common.delete')}</button>}
            </div>
          )}
        </div>
        <button className="icon-btn" title={t('common.close')} onClick={onClose}><X size={16} /></button>
      </div>

      <div className="host-panel-body">
        <div className="card tight">
          <div className="field">
            <label>{t('hostEditor.label')}</label>
            <input className="input" value={h.label ?? ''} placeholder={t('hostEditor.labelPlaceholder')}
              onChange={(e) => set({ label: e.target.value })} onBlur={() => commit()} />
          </div>
          <div className="field">
            <label>{t('hostEditor.parentGroup')}</label>
            <select className="input" value={h.groupId ?? ''} onChange={(e) => commit({ groupId: e.target.value })}>
              <option value="">{t('hostEditor.noGroup')}</option>
              {data.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{t('hostEditor.tags')}</label>
            <TagInput value={h.tags ?? []} onChange={(tags) => commit({ tags })} placeholder={t('hostEditor.tagsPlaceholder')} />
          </div>
        </div>

        <button className="host-panel-share" onClick={() => setShare(true)} disabled={isNew}>
          <Users size={15} /> {t('hosts.shareThisHost')}
        </button>

        <div className="card tight">
          <div className="row">
            <div className="field grow">
              <label>{t('hostEditor.address')}</label>
              <input className="input" value={h.address ?? ''} placeholder={t('hostEditor.addressPlaceholder')}
                onChange={(e) => set({ address: e.target.value })} onBlur={() => commit()} />
            </div>
            <div style={{ width: 90 }}>
              <Field label={t('hostEditor.port')}>
                <input className="input" value={h.port ?? 22} inputMode="numeric"
                  onChange={(e) => set({ port: Number(e.target.value.replace(/\D/g, '')) })} onBlur={() => commit()} />
              </Field>
            </div>
          </div>
          <Field label={t('hostEditor.username')}>
            <input className="input" value={h.username ?? ''} placeholder={t('hostEditor.usernamePlaceholder')}
              onChange={(e) => set({ username: e.target.value })} onBlur={() => commit()} />
          </Field>

          <div className="field">
            <label>{t('hostEditor.protocol')}</label>
            <div className="seg" style={{ alignSelf: 'flex-start' }}>
              {(['ssh', 'ftp'] as const).map((pr) => (
                <button key={pr} className={(h.protocol ?? 'ssh') === pr ? 'on' : ''}
                  onClick={() => commit({
                    protocol: pr,
                    port: pr === 'ftp' ? (!h.port || h.port === 22 ? 21 : h.port) : (h.port === 21 ? 22 : h.port),
                    authType: pr === 'ftp' ? 'password' : h.authType,
                  })}>
                  {pr === 'ssh' ? t('hostEditor.protocolSsh') : t('hostEditor.protocolFtp')}
                </button>
              ))}
            </div>
          </div>

          {(h.protocol ?? 'ssh') !== 'ftp' && (
            <div className="field">
              <label>{t('hostEditor.authentication')}</label>
              <div className="seg" style={{ alignSelf: 'flex-start' }}>
                {(['password', 'key', 'agent'] as const).map((ty) => (
                  <button key={ty} className={h.authType === ty ? 'on' : ''} onClick={() => commit({ authType: ty })}>
                    {ty === 'password' ? t('hostEditor.authPassword') : ty === 'key' ? t('hostEditor.authKey') : t('hostEditor.authAgent')}
                  </button>
                ))}
              </div>
            </div>
          )}
          {((h.protocol ?? 'ssh') === 'ftp' || h.authType === 'password') && (
            <Field label={t('hostEditor.password')} hint={t('hostEditor.passwordHint')}>
              <div style={{ position: 'relative' }}>
                <input className="input" type={reveal ? 'text' : 'password'} value={h.password ?? ''}
                  onChange={(e) => set({ password: e.target.value })} onBlur={() => commit()} />
                <button className="icon-btn" style={{ position: 'absolute', right: 2, top: 2 }}
                  onClick={() => setReveal((r) => !r)} title={t('hostEditor.showHide')}>
                  {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </Field>
          )}
          {(h.protocol ?? 'ssh') !== 'ftp' && h.authType === 'key' && (
            <Field label={t('hostEditor.key')} hint={data.keys.length ? undefined : t('hostEditor.addKeyFirst')}>
              <select className="input" value={h.keyId ?? ''} onChange={(e) => commit({ keyId: e.target.value })}>
                <option value="">{t('hostEditor.chooseKey')}</option>
                {data.keys.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
            </Field>
          )}
          {(h.protocol ?? 'ssh') !== 'ftp' && h.authType === 'agent' && <p className="hint" style={{ marginTop: -4 }}>{t('hostEditor.agentHint')}</p>}
        </div>

        <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMore((m) => !m)}>
          {more ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {more ? t('hostEditor.showLess') : t('hostEditor.showMore')}
        </button>
        {more && (
          <div className="card tight">
            {(h.protocol ?? 'ssh') !== 'ftp' && (
              <Field label={t('hostEditor.jumpHost')} hint={t('hostEditor.jumpHostHint')}>
                <select className="input" value={h.jumpHostId ?? ''} onChange={(e) => commit({ jumpHostId: e.target.value })}>
                  <option value="">{t('hostEditor.directConnection')}</option>
                  {others.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              </Field>
            )}
            {(h.protocol ?? 'ssh') !== 'ftp' && (
              <Field label={t('hostEditor.runAfter')} hint={t('hostEditor.runAfterHint')}>
                <input className="input mono" value={h.startupCommand ?? ''}
                  onChange={(e) => set({ startupCommand: e.target.value })} onBlur={() => commit()} />
              </Field>
            )}
            <Field label={t('hostEditor.colour')}>
              <div className="swatches">
                {HOST_COLORS.map((c) => (
                  <button key={c} className={`swatch ${h.color === c ? 'on' : ''}`} style={{ background: c }}
                    onClick={() => commit({ color: c })} />
                ))}
              </div>
            </Field>
            <Field label={t('hostEditor.note')}>
              <textarea className="input" style={{ fontFamily: 'var(--sans)', minHeight: 56 }} value={h.note ?? ''}
                onChange={(e) => set({ note: e.target.value })} onBlur={() => commit()} />
            </Field>
          </div>
        )}
      </div>

      <div className="host-panel-foot">
        {(h.protocol ?? 'ssh') === 'ftp'
          ? <button className="btn primary grow" disabled={!canConnect} onClick={() => onSftp(h as Host)}><FolderOpen size={15} /> {t('hosts.openFileManager')}</button>
          : <button className="btn primary grow" disabled={!canConnect} onClick={() => onConnect(h as Host)}><SquareTerminal size={15} /> {t('hosts.connect')}</button>}
      </div>

      {del && (
        <Confirm title={t('hosts.deleteHostTitle')} danger confirm={t('hosts.deleteHostConfirm')} onClose={() => setDel(false)} onConfirm={remove}>
          <p style={{ marginTop: 0 }}>{t('hosts.deleteHostBody', { name: h.label })}</p>
        </Confirm>
      )}
      {share && !isNew && <ShareHostDialog host={h as Host} peers={data.peers} onClose={() => setShare(false)} />}
    </div>
  )
}

function ShareHostDialog({ host, peers, onClose }: { host: Host; peers: Peer[]; onClose: () => void }) {
  const { t } = useI18n()
  const [peerId, setPeerId] = useState(peers[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!peerId) return
    setBusy(true)
    try {
      const msg: string = await api.ShareSend(peerId, { ...emptySelection(), hostIds: [host.id] })
      toast(t('team.sentResult', { name: peers.find((p) => p.id === peerId)?.name ?? '', msg }), 'ok')
      onClose()
    } catch (e) { toast(errMsg(e), 'err') }
    finally { setBusy(false) }
  }
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 380 }}>
        <div className="modal-head"><h3>{t('hosts.shareTitle', { name: host.label })}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {peers.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t('hosts.noPeers')}</p> : (
            <Field label={t('hosts.sharePeerPrompt')}>
              <select className="input" value={peerId} onChange={(e) => setPeerId(e.target.value)}>
                {peers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={!peerId || busy} onClick={send}>
            <Send size={13} /> {busy ? t('team.waitingAccept') : t('team.sendBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}
