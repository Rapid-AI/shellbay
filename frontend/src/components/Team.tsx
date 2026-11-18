import { useEffect, useState } from 'react'
import { Copy, Send, Trash2 } from 'lucide-react'
import Modal, { Confirm, TextPrompt } from './Modal'
import SelectionPicker, { emptySelection } from './SelectionPicker'
import { api, errMsg } from '../api'
import { toast } from '../toast'
import { groupFingerprint } from '../util'
import { useI18n } from '../i18n'
import type { Peer, Selection, VaultData } from '../types'

export default function Team({ data, reload }: { data: VaultData; reload: () => void }) {
  const { t } = useI18n()
  const [st, setSt] = useState<any>(null)
  const [port, setPort] = useState(7878)
  const [name, setName] = useState('')
  const [addr, setAddr] = useState('')
  const [invite, setInvite] = useState<null | { link: string; expiresAt: number }>(null)
  const [now, setNow] = useState(Date.now())
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [sendTo, setSendTo] = useState<Peer | null>(null)
  const [addrFor, setAddrFor] = useState<Peer | null>(null)
  const [removing, setRemoving] = useState<Peer | null>(null)

  const refreshStatus = async () => {
    const s = await api.ShareStatus()
    setSt(s)
    setPort(s.port)
    setName(s.deviceName)
    setAddr((a) => a || s.addresses[0]?.ip || '')
  }
  useEffect(() => { refreshStatus().catch(() => {}) }, [])
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])

  if (!st) return <div className="view muted">{t('team.loading')}</div>

  const toggleListen = async () => {
    try {
      if (st.listening) await api.ShareDisable()
      else await api.ShareEnable(Number(port))
      setInvite(null)
      await refreshStatus()
      reload()
    } catch (e) { toast(errMsg(e), 'err') }
  }

  const createInvite = async () => {
    try { setInvite(await api.ShareInvite(addr)) }
    catch (e) { toast(errMsg(e), 'err') }
  }

  const join = async () => {
    setBusy(true)
    try {
      const p: Peer = await api.ShareJoin(link)
      toast(t('team.pairedWith', { name: p.name }), 'ok')
      setLink('')
      reload()
    } catch (e) { toast(errMsg(e), 'err') }
    finally { setBusy(false) }
  }

  const left = invite ? Math.max(0, Math.round((invite.expiresAt - now) / 1000)) : 0

  return (
    <div className="view" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <h1>{t('team.title')}</h1>
        <span className="sub">{t('team.subtitle')}</span>
      </div>

      <div className="card">
        <h3>{t('team.thisComputer')}</h3>
        <div className="row">
          <div className="field">
            <label>{t('team.nameShown')}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)}
              onBlur={() => api.ShareSetName(name).then(refreshStatus).catch((e) => toast(errMsg(e), 'err'))} />
          </div>
          <div style={{ width: 120 }} className="field">
            <label>{t('team.port')}</label>
            <input className="input" disabled={st.listening} inputMode="numeric" value={port}
              onChange={(e) => setPort(Number(e.target.value.replace(/\D/g, '')))} />
          </div>
          <button className={`btn ${st.listening ? '' : 'primary'}`} style={{ marginTop: 8 }} onClick={toggleListen}>
            {st.listening ? t('team.stopReceiving') : t('team.startReceiving')}
          </button>
        </div>
        <div className="label">{t('team.fingerprint')}</div>
        <div className="code" style={{ marginTop: 4 }}>{groupFingerprint(st.fingerprint)}</div>
        <p className="hint">
          {st.listening
            ? t('team.listeningHint', { port: st.port, addrs: st.addresses.map((a: any) => a.ip).join(' / ') || '?' })
            : t('team.offHint')}
        </p>
      </div>

      <div className="card">
        <h3>{t('team.inviteTitle')}</h3>
        {!st.listening ? (
          <p className="muted" style={{ margin: 0 }}>{t('team.startFirst')}</p>
        ) : (
          <>
            <div className="row">
              <div className="field">
                <label>{t('team.addressFor')}</label>
                <select className="input" value={addr} onChange={(e) => setAddr(e.target.value)}>
                  {st.addresses.map((a: any) => <option key={a.ip + a.name} value={a.ip}>{a.ip} · {a.name}</option>)}
                </select>
              </div>
              <button className="btn primary" style={{ marginTop: 8 }} disabled={!addr} onClick={createInvite}>{t('team.createInvite')}</button>
            </div>
            {invite && (
              <>
                <div className="code">{invite.link}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn sm" onClick={() => { navigator.clipboard.writeText(invite.link); toast(t('team.inviteCopied'), 'ok') }}><Copy size={13} /> {t('team.copyInvite')}</button>
                  <span className={left > 0 ? 'muted' : 'err'}>{left > 0 ? t('team.validFor', { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` }) : t('team.expired')}</span>
                </div>
                <p className="hint">{t('team.inviteHint')}</p>
              </>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h3>{t('team.joinTitle')}</h3>
        <div className="row">
          <input className="input mono" placeholder={t('team.linkPlaceholder')} value={link} onChange={(e) => setLink(e.target.value)} />
          <button className="btn primary" disabled={!link.trim() || busy} onClick={join}>{busy ? t('team.pairing') : t('team.pair')}</button>
        </div>
        <p className="hint">{t('team.joinHint')}</p>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <h3 style={{ padding: '16px 18px 0' }}>{t('team.teammates')}</h3>
        {data.peers.length === 0 && <p className="muted" style={{ padding: '0 18px 16px', margin: '8px 0 0' }}>{t('team.nobodyPaired')}</p>}
        {data.peers.map((p) => (
          <div className="lrow" key={p.id}>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div className="muted mono" style={{ fontSize: 11.5 }}>{p.address || t('team.noAddressYet')} · {groupFingerprint(p.fingerprint).slice(0, 19)}…</div>
            </div>
            <button className="btn sm primary" onClick={() => setSendTo(p)}><Send size={12} /> {t('team.send')}</button>
            <button className="btn sm" onClick={() => setAddrFor(p)}>{t('team.address')}</button>
            <button className="icon-btn" title={t('team.unpair')} onClick={() => setRemoving(p)}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

      {sendTo && <SendDialog peer={sendTo} data={data} onClose={() => setSendTo(null)} />}
      {addrFor && (
        <TextPrompt title={t('team.addressOf', { name: addrFor.name })} label={t('team.ipAndPort')} initial={addrFor.address} confirm={t('common.save')}
          onClose={() => setAddrFor(null)}
          onSubmit={async (v) => { try { await api.ShareSetPeerAddress(addrFor.id, v); reload(); setAddrFor(null) } catch (e) { toast(errMsg(e), 'err') } }} />
      )}
      {removing && (
        <Confirm title={t('team.unpairTitle')} danger confirm={t('team.unpairConfirm')} onClose={() => setRemoving(null)}
          onConfirm={async () => { await api.ShareRemovePeer(removing.id); reload() }}>
          <p style={{ marginTop: 0 }}>{t('team.unpairBody', { name: removing.name })}</p>
        </Confirm>
      )}
    </div>
  )
}

function SendDialog({ peer, data, onClose }: { peer: Peer; data: VaultData; onClose: () => void }) {
  const { t } = useI18n()
  const [sel, setSel] = useState<Selection>(emptySelection())
  const [busy, setBusy] = useState(false)
  const count = sel.hostIds.length + sel.snippetIds.length + sel.forwardIds.length + sel.keyIds.length
  const run = async () => {
    setBusy(true)
    try {
      const msg: string = await api.ShareSend(peer.id, sel)
      toast(t('team.sentResult', { name: peer.name, msg }), 'ok')
      onClose()
    } catch (e) { toast(errMsg(e), 'err') }
    finally { setBusy(false) }
  }
  return (
    <Modal title={t('team.sendTo', { name: peer.name })} onClose={busy ? () => {} : onClose} width={560}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!count || busy} onClick={run}>{busy ? t('team.waitingAccept') : t('team.sendBtn')}</button></>}>
      <SelectionPicker data={data} value={sel} onChange={setSel} />
    </Modal>
  )
}
