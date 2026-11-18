import { useEffect, useState } from 'react'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import Modal, { Field } from './Modal'
import { api, on } from '../api'
import { useI18n } from '../i18n'

interface PromptReq { id: string; kind: string; title: string; message: string; detail: string; secret: boolean }
interface Offer { id: string; from: string; summary: string; hasSecrets: boolean }

export default function Prompts() {
  const { t } = useI18n()
  const [queue, setQueue] = useState<PromptReq[]>([])
  const [offers, setOffers] = useState<Offer[]>([])
  const [value, setValue] = useState('')
  const [overwrite, setOverwrite] = useState(false)

  useEffect(() => {
    const a = on('prompt:request', (p) => setQueue((q) => [...q, p]))
    const b = on('share:offer', (o) => setOffers((q) => [...q, o]))
    return () => { a(); b() }
  }, [])

  const cur = queue[0]
  const offer = offers[0]

  function answer(ok: boolean, v: string) {
    if (!cur) return
    api.AnswerPrompt(cur.id, v, !ok)
    setQueue((q) => q.slice(1))
    setValue('')
  }

  if (cur) {
    const hostKey = cur.kind === 'hostkey' || cur.kind === 'hostkey-changed'
    const changed = cur.kind === 'hostkey-changed'
    if (hostKey) {
      return (
        <Modal title={cur.title} onClose={() => answer(false, '')} width={480}
          footer={<>
            <button className="btn" onClick={() => answer(false, '')}>{t('common.cancel')}</button>
            <button className={`btn ${changed ? 'danger' : 'primary'}`} onClick={() => answer(true, 'yes')}>
              {changed ? t('prompts.replaceKeyConnect') : t('prompts.trustConnect')}
            </button>
          </>}>
          <div className={`banner ${changed ? 'danger' : ''}`} style={{ display: 'flex', gap: 10 }}>
            {changed ? <AlertTriangle size={18} /> : <ShieldCheck size={18} />}
            <span>{cur.message}</span>
          </div>
          <div className="label">{t('prompts.fingerprint')}</div>
          <div className="code" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{cur.detail}</div>
          <p className="hint">{t('prompts.compareFingerprint')}</p>
        </Modal>
      )
    }
    return (
      <Modal title={cur.title} onClose={() => answer(false, '')} width={420}
        footer={<>
          <button className="btn" onClick={() => answer(false, '')}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={() => answer(true, value)}>{t('prompts.continue')}</button>
        </>}>
        <Field label={cur.message} hint={cur.detail || undefined}>
          <input
            className="input" autoFocus type={cur.secret ? 'password' : 'text'}
            value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') answer(true, value) }}
          />
        </Field>
      </Modal>
    )
  }

  if (offer) {
    const reply = (accept: boolean) => {
      api.ShareRespond(offer.id, accept, overwrite)
      setOffers((q) => q.slice(1))
      setOverwrite(false)
    }
    return (
      <Modal title={t('prompts.wantsToShare', { name: offer.from })} onClose={() => reply(false)} width={480}
        footer={<>
          <button className="btn" onClick={() => reply(false)}>{t('prompts.decline')}</button>
          <button className="btn primary" onClick={() => reply(true)}>{t('prompts.acceptImport')}</button>
        </>}>
        <p style={{ marginTop: 0 }}>{offer.summary}</p>
        {offer.hasSecrets && (
          <div className="banner warn">{t('prompts.secretsWarning')}</div>
        )}
        <label className="check">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          {t('prompts.replaceReceived')}
        </label>
      </Modal>
    )
  }
  return null
}
