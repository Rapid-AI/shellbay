import { useState } from 'react'
import { Shell } from 'lucide-react'
import { api, errMsg } from '../api'
import { useI18n, LANGS } from '../i18n'
import type { Lang } from '../i18n'

export default function Unlock({ status, lang, onLangChange, onDone }: {
  status: string; lang: Lang; onLangChange: (l: Lang) => void; onDone: () => void
}) {
  const { t } = useI18n()
  const creating = status === 'uninitialized'
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setErr('')
    if (creating) {
      if (pw.length < 8) return setErr(t('unlock.use8chars'))
      if (pw !== pw2) return setErr(t('unlock.passwordsNoMatch'))
    }
    setBusy(true)
    try {
      if (creating) await api.VaultCreate(pw)
      else await api.VaultUnlock(pw)
      onDone()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="unlock">
      <select className="input lang-pick" value={lang} onChange={(e) => onLangChange(e.target.value as Lang)}>
        {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
      <div className="unlock-card">
        <div className="logo"><Shell size={26} /></div>
        <h1>{creating ? t('unlock.createTitle') : t('unlock.unlockTitle')}</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          {creating ? t('unlock.createBody') : t('unlock.unlockBody')}
        </p>
        <div className="field">
          <input
            className="input" type="password" autoFocus placeholder={t('unlock.masterPasswordPlaceholder')}
            value={pw} onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !creating) submit() }}
          />
        </div>
        {creating && (
          <div className="field">
            <input
              className="input" type="password" placeholder={t('unlock.repeatPasswordPlaceholder')}
              value={pw2} onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            />
          </div>
        )}
        {err && <div className="banner danger">{err}</div>}
        <button className="btn primary" style={{ width: '100%', height: 34 }} onClick={submit} disabled={busy || !pw}>
          {busy ? t('common.working') : creating ? t('unlock.createVault') : t('unlock.unlock')}
        </button>
      </div>
    </div>
  )
}
