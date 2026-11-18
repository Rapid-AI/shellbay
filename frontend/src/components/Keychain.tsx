import { useState } from 'react'
import { Copy, KeyRound, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import Modal, { Confirm, Field, TextPrompt } from './Modal'
import { api, errMsg } from '../api'
import { toast } from '../toast'
import { useI18n } from '../i18n'
import type { Key, VaultData } from '../types'

export default function Keychain({ data, reload }: { data: VaultData; reload: () => void }) {
  const { t } = useI18n()
  const [dlg, setDlg] = useState<any>(null)

  return (
    <div className="view">
      <div className="page-head">
        <h1>{t('keychain.title')}</h1>
        <span className="sub">{t('keychain.subtitle', { n: data.keys.length })}</span>
        <span className="grow" />
        <button className="btn" onClick={() => setDlg({ kind: 'import' })}><Upload size={15} /> {t('keychain.importKey')}</button>
        <button className="btn primary" onClick={() => setDlg({ kind: 'generate' })}><Plus size={15} /> {t('keychain.generateKey')}</button>
      </div>

      {data.keys.length === 0 && (
        <div className="empty"><h3>{t('keychain.emptyTitle')}</h3><p>{t('keychain.emptyBody')}</p></div>
      )}
      {data.keys.length > 0 && (
        <div className="list">
          {data.keys.map((k) => (
            <div className="lrow" key={k.id}>
              <KeyRound size={18} color="var(--muted)" />
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{k.name}</div>
                <div className="muted mono ellipsis" style={{ fontSize: 11.5 }}>{k.type} {k.fingerprint}</div>
                <div className="faint" style={{ fontSize: 12 }}>
                  {t('keychain.usedBy', { n: data.hosts.filter((h) => h.keyId === k.id).length })}
                </div>
              </div>
              <button className="btn sm" disabled={!k.publicKey} onClick={() => setDlg({ kind: 'deploy', key: k })}>{t('keychain.installOnServer')}</button>
              <button className="icon-btn" title={t('keychain.copyPublicKey')} disabled={!k.publicKey}
                onClick={() => { navigator.clipboard.writeText(k.publicKey); toast(t('keychain.publicKeyCopied'), 'ok') }}><Copy size={15} /></button>
              <button className="icon-btn" title={t('keychain.rename')} onClick={() => setDlg({ kind: 'rename', key: k })}><Pencil size={15} /></button>
              <button className="icon-btn" title={t('keychain.delete')} onClick={() => setDlg({ kind: 'delete', key: k })}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}

      {dlg?.kind === 'generate' && <GenerateDialog onClose={() => setDlg(null)} onDone={reload} />}
      {dlg?.kind === 'import' && <ImportDialog onClose={() => setDlg(null)} onDone={reload} />}
      {dlg?.kind === 'deploy' && <DeployDialog k={dlg.key} data={data} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'rename' && (
        <TextPrompt title={t('keychain.renameKeyTitle')} label={t('keychain.name')} initial={dlg.key.name} confirm={t('common.rename')} onClose={() => setDlg(null)}
          onSubmit={async (name) => { try { await api.KeyRename(dlg.key.id, name); reload(); setDlg(null) } catch (e) { toast(errMsg(e), 'err') } }} />
      )}
      {dlg?.kind === 'delete' && (
        <Confirm title={t('keychain.deleteKeyTitle')} danger confirm={t('keychain.deleteKeyConfirm')} onClose={() => setDlg(null)}
          onConfirm={async () => { await api.KeyDelete(dlg.key.id); reload() }}>
          <p style={{ marginTop: 0 }}>{t('keychain.deleteKeyBody', { name: dlg.key.name })}</p>
        </Confirm>
      )}
    </div>
  )
}

function GenerateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [type, setType] = useState('ed25519')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try { await api.KeyGenerate(name, type, pass); onDone(); onClose(); toast(t('keychain.keyCreated'), 'ok') }
    catch (e) { toast(errMsg(e), 'err') }
    finally { setBusy(false) }
  }
  return (
    <Modal title={t('keychain.generateTitle')} onClose={onClose} width={460}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={busy || !name.trim()} onClick={run}>{busy ? t('keychain.generating') : t('keychain.generate')}</button></>}>
      <Field label={t('keychain.name')}><input className="input" autoFocus value={name} placeholder={t('keychain.namePlaceholder')} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="field"><label>{t('keychain.type')}</label>
        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          <button className={type === 'ed25519' ? 'on' : ''} onClick={() => setType('ed25519')}>{t('keychain.ed25519')}</button>
          <button className={type === 'rsa' ? 'on' : ''} onClick={() => setType('rsa')}>{t('keychain.rsa')}</button>
        </div>
      </div>
      <Field label={t('keychain.passphraseOptional')} hint={t('keychain.passphraseHint')}>
        <input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
      </Field>
      {type === 'rsa' && <p className="hint">{t('keychain.rsaSlow')}</p>}
    </Modal>
  )
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [pem, setPem] = useState('')
  const [pass, setPass] = useState('')
  const pick = async () => {
    try {
      const path: string = await api.PickOpenFile(t('keychain.privateKey'))
      if (!path) return
      setPem(await api.ReadLocalText(path))
      if (!name) setName(path.split('/').pop() || '')
    } catch (e) { toast(errMsg(e), 'err') }
  }
  const run = async () => {
    try { await api.KeyImport(name, pem, pass); onDone(); onClose(); toast(t('keychain.keyImported'), 'ok') }
    catch (e) { toast(errMsg(e), 'err') }
  }
  return (
    <Modal title={t('keychain.importTitle')} onClose={onClose} width={540}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!name.trim() || !pem.trim()} onClick={run}>{t('keychain.import')}</button></>}>
      <Field label={t('keychain.name')}><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t('keychain.privateKey')}>
        <textarea className="input" style={{ minHeight: 140 }} value={pem} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          onChange={(e) => setPem(e.target.value)} />
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={pick}>{t('keychain.chooseFile')}</button>
      </Field>
      <Field label={t('keychain.passphraseEncryptedOnly')}>
        <input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
      </Field>
    </Modal>
  )
}

function DeployDialog({ k, data, onClose }: { k: Key; data: VaultData; onClose: () => void }) {
  const { t } = useI18n()
  const [hostId, setHostId] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try { const m = await api.KeyDeploy(k.id, hostId); toast(m, 'ok'); onClose() }
    catch (e) { toast(errMsg(e), 'err') }
    finally { setBusy(false) }
  }
  return (
    <Modal title={t('keychain.installTitle')} onClose={onClose} width={460}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!hostId || busy} onClick={run}>{busy ? t('keychain.installing') : t('keychain.install')}</button></>}>
      <p style={{ marginTop: 0 }}>{t('keychain.installBody', { name: k.name })}</p>
      <Field label={t('keychain.host')}>
        <select className="input" value={hostId} onChange={(e) => setHostId(e.target.value)}>
          <option value="">{t('keychain.chooseHost')}</option>
          {data.hosts.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
        </select>
      </Field>
    </Modal>
  )
}
