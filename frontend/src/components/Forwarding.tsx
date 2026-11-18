import { useState } from 'react'
import { Pencil, Play, Plus, Square, Trash2 } from 'lucide-react'
import Modal, { Confirm, Field } from './Modal'
import { api, errMsg } from '../api'
import { toast } from '../toast'
import { useI18n } from '../i18n'
import type { I18n } from '../i18n'
import type { Forward, VaultData } from '../types'

export type FwdStates = Record<string, { state: string; error: string }>

function describe(t: I18n['t'], f: Forward, host?: string) {
  const bind = `${f.bindAddr || '127.0.0.1'}:${f.bindPort}`
  if (f.type === 'dynamic') return t('fwd.descDynamic', { bind, host: host ?? '?' })
  if (f.type === 'local') return t('fwd.descLocal', { bind, dest: `${f.destAddr}:${f.destPort}`, host: host ?? '?' })
  return t('fwd.descRemote', { host: host ?? '?', port: f.bindPort, dest: `${f.destAddr}:${f.destPort}` })
}

export default function Forwarding({ data, reload, states }: { data: VaultData; reload: () => void; states: FwdStates }) {
  const { t } = useI18n()
  const [edit, setEdit] = useState<Partial<Forward> | null>(null)
  const [del, setDel] = useState<Forward | null>(null)

  const toggle = async (f: Forward) => {
    try {
      if (states[f.id]?.state === 'running') await api.FwdStop(f.id)
      else await api.FwdStart(f.id)
    } catch (e) { toast(errMsg(e), 'err') }
  }

  return (
    <div className="view">
      <div className="page-head">
        <h1>{t('fwd.title')}</h1>
        <span className="sub">{t('fwd.subtitle')}</span>
        <span className="grow" />
        <button className="btn primary" disabled={!data.hosts.length}
          onClick={() => setEdit({ type: 'local', bindAddr: '127.0.0.1', hostId: data.hosts[0]?.id })}><Plus size={15} /> {t('fwd.newRule')}</button>
      </div>
      {!data.hosts.length && <div className="empty"><h3>{t('fwd.addHostFirstTitle')}</h3><p>{t('fwd.addHostFirstBody')}</p></div>}
      {data.hosts.length > 0 && data.forwards.length === 0 && (
        <div className="empty"><h3>{t('fwd.emptyTitle')}</h3><p>{t('fwd.emptyBody')}</p></div>
      )}
      {data.forwards.length > 0 && (
        <div className="list">
          {data.forwards.map((f) => {
            const st = states[f.id]
            const running = st?.state === 'running'
            return (
              <div className="lrow" key={f.id}>
                <span className={`pill ${running ? 'run' : st?.state === 'error' ? 'err' : ''}`}>{running ? t('fwd.running') : st?.state === 'error' ? t('fwd.error') : f.type}</span>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{f.name}</div>
                  <div className="muted mono ellipsis" style={{ fontSize: 12 }}>{describe(t, f, data.hosts.find((h) => h.id === f.hostId)?.label)}</div>
                  {st?.state === 'error' && <div className="err" style={{ fontSize: 12 }}>{st.error}</div>}
                </div>
                <button className={`btn sm ${running ? '' : 'primary'}`} onClick={() => toggle(f)}>
                  {running ? <><Square size={12} /> {t('fwd.stop')}</> : <><Play size={12} /> {t('fwd.start')}</>}
                </button>
                <button className="icon-btn" disabled={running} title={running ? t('fwd.stopToEdit') : t('fwd.edit')} onClick={() => setEdit(f)}><Pencil size={15} /></button>
                <button className="icon-btn" onClick={() => setDel(f)}><Trash2 size={15} /></button>
              </div>
            )
          })}
        </div>
      )}

      {edit && (
        <Modal title={edit.id ? t('fwd.editRuleTitle') : t('fwd.newRuleTitle')} onClose={() => setEdit(null)} width={520}
          footer={<><button className="btn" onClick={() => setEdit(null)}>{t('common.cancel')}</button>
            <button className="btn primary" onClick={async () => {
              try { await api.SaveForward({ ...edit, bindPort: Number(edit.bindPort), destPort: Number(edit.destPort) || 0 }); reload(); setEdit(null) }
              catch (e) { toast(errMsg(e), 'err') }
            }}>{t('common.save')}</button></>}>
          <div className="field"><label>{t('fwd.type')}</label>
            <div className="seg" style={{ alignSelf: 'flex-start' }}>
              {(['local', 'remote', 'dynamic'] as const).map((ty) => (
                <button key={ty} className={edit.type === ty ? 'on' : ''} onClick={() => setEdit({ ...edit, type: ty })}>
                  {ty === 'local' ? t('fwd.local') : ty === 'remote' ? t('fwd.remote') : t('fwd.dynamic')}
                </button>
              ))}
            </div>
            <div className="hint">
              {edit.type === 'local' && t('fwd.hintLocal')}
              {edit.type === 'remote' && t('fwd.hintRemote')}
              {edit.type === 'dynamic' && t('fwd.hintDynamic')}
            </div>
          </div>
          <div className="row">
            <Field label={t('fwd.name')}><input className="input" value={edit.name ?? ''} placeholder={t('fwd.namePlaceholder')} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label={t('fwd.host')}>
              <select className="input" value={edit.hostId ?? ''} onChange={(e) => setEdit({ ...edit, hostId: e.target.value })}>
                {data.hosts.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label={edit.type === 'remote' ? t('fwd.listenAddressServer') : t('fwd.listenAddress')}>
              <input className="input" value={edit.bindAddr ?? ''} placeholder="127.0.0.1" onChange={(e) => setEdit({ ...edit, bindAddr: e.target.value })} />
            </Field>
            <div style={{ width: 110 }}><Field label={t('hostEditor.port')}>
              <input className="input" inputMode="numeric" value={edit.bindPort ?? ''} onChange={(e) => setEdit({ ...edit, bindPort: Number(e.target.value.replace(/\D/g, '')) })} />
            </Field></div>
          </div>
          {edit.type !== 'dynamic' && (
            <div className="row">
              <Field label={t('fwd.destAddress')}><input className="input" value={edit.destAddr ?? ''} placeholder={t('fwd.destPlaceholder')} onChange={(e) => setEdit({ ...edit, destAddr: e.target.value })} /></Field>
              <div style={{ width: 110 }}><Field label={t('hostEditor.port')}>
                <input className="input" inputMode="numeric" value={edit.destPort ?? ''} onChange={(e) => setEdit({ ...edit, destPort: Number(e.target.value.replace(/\D/g, '')) })} />
              </Field></div>
            </div>
          )}
        </Modal>
      )}
      {del && (
        <Confirm title={t('fwd.deleteRuleTitle')} danger confirm={t('fwd.deleteRuleConfirm')} onClose={() => setDel(null)}
          onConfirm={async () => { await api.DeleteForward(del.id); reload() }}>
          <p style={{ marginTop: 0 }}>{t('fwd.deleteRuleBody', { name: del.name })}</p>
        </Confirm>
      )}
    </div>
  )
}
