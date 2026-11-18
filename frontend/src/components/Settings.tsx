import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import Modal, { Field } from './Modal'
import Switch from './Switch'
import SelectionPicker, { emptySelection } from './SelectionPicker'
import { api, errMsg } from '../api'
import { toast } from '../toast'
import { fmtSize } from '../util'
import { THEMES } from '../themes'
import { BUILTIN_THEMES } from '../builtinThemes'
import { DEFAULT_FAMILY, isFamilyId, resolveTheme } from '../themeEngine'
import type { ThemeManifest } from '../themeEngine'
import type { PluginManifest } from '../pluginEngine'
import { useI18n, LANGS } from '../i18n'
import type { ResumableRecord, Selection, Settings as S, VaultData } from '../types'

interface Props {
  data: VaultData; reload: () => void; onLock: () => void
  installedThemes: ThemeManifest[]; reloadThemes: () => void
  installedPlugins: PluginManifest[]; reloadPlugins: () => void
}

const FONTS = [
  ['SF Mono', '"SF Mono", Menlo, Monaco, monospace'],
  ['Menlo', 'Menlo, Monaco, monospace'],
  ['Monaco', 'Monaco, Menlo, monospace'],
  ['Courier New', '"Courier New", monospace'],
]

export default function Settings({ data, reload, onLock, installedThemes, reloadThemes, installedPlugins, reloadPlugins }: Props) {
  const { t } = useI18n()
  const s = data.settings
  const [dlg, setDlg] = useState<null | 'export' | 'password'>(null)
  const [importPath, setImportPath] = useState('')
  const [info, setInfo] = useState<Record<string, string>>({})
  const [resumables, setResumables] = useState<ResumableRecord[]>([])
  useEffect(() => { api.AppInfo().then(setInfo).catch(() => {}) }, [])
  useEffect(() => { api.ResumableTransfers().then(setResumables).catch(() => {}) }, [])
  const dismissResumable = async (id: string) => {
    await api.ResumeDismiss(id)
    setResumables((r) => r.filter((x) => x.id !== id))
  }

  const save = async (patch: Partial<S>) => {
    try { await api.SaveSettings({ ...s, ...patch }); reload() }
    catch (e) { toast(errMsg(e), 'err') }
  }

  const pickImport = async () => {
    try {
      const p: string = await api.ImportPick()
      if (p) setImportPath(p)
    } catch (e) { toast(errMsg(e), 'err') }
  }

  const installTheme = async () => {
    try {
      const p: string = await api.ThemePickFile()
      if (!p) return
      const m: ThemeManifest = await api.ThemeImportFile(p)
      reloadThemes()
      toast(t('settings.uiThemeInstalled', { name: m.name }), 'ok')
      await save({ uiThemeId: m.id })
    } catch (e) { toast(errMsg(e), 'err') }
  }

  const deleteTheme = async (id: string) => {
    try {
      await api.ThemeDelete(id)
      reloadThemes()
      if (s.uiThemeId === id) await save({ uiThemeId: 'classic' })
      toast(t('settings.uiThemeDeleted'), 'ok')
    } catch (e) { toast(errMsg(e), 'err') }
  }

  const installPlugin = async () => {
    try {
      const p: string = await api.PluginPickFile()
      if (!p) return
      const m: PluginManifest = await api.PluginImportFile(p)
      reloadPlugins()
      toast(t('settings.pluginInstalled', { name: m.name }), 'ok')
    } catch (e) { toast(errMsg(e), 'err') }
  }

  const deletePlugin = async (id: string) => {
    try {
      await api.PluginDelete(id)
      reloadPlugins()
      toast(t('settings.pluginDeleted'), 'ok')
    } catch (e) { toast(errMsg(e), 'err') }
  }

  const togglePlugin = async (id: string, enabled: boolean) => {
    const disabled = new Set(s.disabledPluginIds ?? [])
    if (enabled) disabled.delete(id)
    else disabled.add(id)
    await save({ disabledPluginIds: [...disabled] })
  }

  const sshConfig = async () => {
    try {
      const r = await api.ImportSSHConfig('')
      toast(t('settings.importedSSHResult', { summary: r.summary }), 'ok')
      reload()
    } catch (e) { toast(errMsg(e), 'err') }
  }

  return (
    <div className="view" style={{ maxWidth: 820 }}>
      <div className="page-head"><h1>{t('settings.title')}</h1></div>

      <div className="card">
        <h3>{t('settings.appearance')}</h3>
        {(() => {
          const activeTheme = resolveTheme(s.uiThemeId ?? DEFAULT_FAMILY, s.uiTheme ?? 'dark', installedThemes)
          const activeFamily = activeTheme.family ?? DEFAULT_FAMILY
          const adaptive = isFamilyId(s.uiThemeId ?? DEFAULT_FAMILY, installedThemes)
          return (
            <>
              <div className="field">
                <div className="seg" style={{ alignSelf: 'flex-start' }}>
                  {(['dark', 'light', 'system'] as const).map((th) => (
                    <button
                      key={th}
                      className={adaptive && (s.uiTheme ?? 'dark') === th ? 'on' : ''}
                      onClick={() => save({ uiTheme: th, uiThemeId: activeFamily })}
                    >
                      {th === 'dark' ? t('settings.themeDark') : th === 'light' ? t('settings.themeLight') : t('settings.themeSystem')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>{t('settings.uiThemeGallery')}</label>
                <div className="theme-gallery">
                  {[...BUILTIN_THEMES, ...installedThemes].map((th) => (
                    <div key={th.id} className={`theme-swatch-item ${activeTheme.id === th.id ? 'on' : ''}`}>
                      <button
                        className="theme-swatch"
                        title={th.name}
                        onClick={() => save({ uiThemeId: th.id })}
                        style={{ background: th.colors.bg, borderColor: th.colors.line }}
                      >
                        <span style={{ background: th.colors.accent }} />
                        <span style={{ background: th.colors.panel }} />
                        <span style={{ background: th.colors.text }} />
                      </button>
                      <span className="theme-swatch-label ellipsis">{th.name}</span>
                      {!th.id.startsWith('classic-') && !th.id.startsWith('simple-') && (
                        <button className="icon-btn theme-swatch-del" title={t('settings.uiThemeDelete')} onClick={() => deleteTheme(th.id)}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button className="theme-swatch-item theme-swatch-add" onClick={installTheme}>
                    <span className="theme-swatch theme-swatch-add-icon">+</span>
                    <span className="theme-swatch-label">{t('settings.uiThemeInstall')}</span>
                  </button>
                </div>
              </div>
            </>
          )
        })()}
      </div>

      <div className="card">
        <h3>{t('settings.plugins')}</h3>
        <p className="hint" style={{ marginTop: 0 }}>{t('settings.pluginsHint')}</p>
        {installedPlugins.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{t('settings.pluginsEmpty')}</p>}
        {installedPlugins.map((p) => {
          const enabled = !(s.disabledPluginIds ?? []).includes(p.id)
          return (
            <div key={p.id} className="plugin-row">
              <Switch checked={enabled} onChange={(v) => togglePlugin(p.id, v)} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="name ellipsis">{p.name} <span className="faint">v{p.version}</span></div>
                <div className="meta ellipsis">{p.author ? `${p.author} · ` : ''}{p.capabilities.join(', ')}</div>
              </div>
              <button className="icon-btn" title={t('settings.pluginDelete')} onClick={() => deletePlugin(p.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          )
        })}
        <button className="btn sm" style={{ marginTop: 8 }} onClick={installPlugin}>{t('settings.pluginInstall')}</button>
      </div>

      <div className="card">
        <h3>{t('settings.language')}</h3>
        <div className="chips" style={{ marginBottom: 0 }}>
          {LANGS.map((l) => (
            <button key={l.code} className={`chip ${s.language === l.code ? 'on' : ''}`} onClick={() => save({ language: l.code })}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>{t('settings.terminal')}</h3>
        <div className="field">
          <label>{t('settings.colourTheme')}</label>
          <div className="chips" style={{ marginBottom: 0 }}>
            {THEMES.map((th) => (
              <button key={th.name} className={`chip ${s.theme === th.name ? 'on' : ''}`} onClick={() => save({ theme: th.name })}>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: th.theme.background, border: '1px solid var(--line)', marginRight: 6 }} />
                {th.label}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <Field label={t('settings.font')}>
            <select className="input" value={s.fontFamily} onChange={(e) => save({ fontFamily: e.target.value })}>
              {FONTS.map(([n, v]) => <option key={n} value={v}>{n}</option>)}
            </select>
          </Field>
          <Field label={t('settings.fontSize')}>
            <input className="input" type="number" min={8} max={32} value={s.fontSize} onChange={(e) => save({ fontSize: Number(e.target.value) })} />
          </Field>
          <Field label={t('settings.scrollback')}>
            <input className="input" type="number" min={1000} step={1000} value={s.scrollback} onChange={(e) => save({ scrollback: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="row">
          <div className="field">
            <label>{t('settings.cursor')}</label>
            <div className="seg" style={{ alignSelf: 'flex-start' }}>
              {(['block', 'bar', 'underline'] as const).map((c) => (
                <button key={c} className={s.cursorStyle === c ? 'on' : ''} onClick={() => save({ cursorStyle: c })}>{c}</button>
              ))}
            </div>
          </div>
          <Field label={t('settings.keepAlive')} hint={t('settings.keepAliveHint')}>
            <input className="input" type="number" min={5} value={s.keepAliveSec} onChange={(e) => save({ keepAliveSec: Number(e.target.value) })} />
          </Field>
        </div>
        <Switch checked={s.logSessions} onChange={(v) => save({ logSessions: v })} label={t('settings.logSessions')} />
        {s.logSessions && (
          <>
            <div className="field" style={{ marginTop: 8 }}>
              <label>{t('settings.logFormat')}</label>
              <div className="seg" style={{ alignSelf: 'flex-start' }}>
                {(['plain', 'raw'] as const).map((f) => (
                  <button key={f} className={(s.logFormat ?? 'plain') === f ? 'on' : ''} onClick={() => save({ logFormat: f })}>
                    {f === 'plain' ? t('settings.logFormatPlain') : t('settings.logFormatRaw')}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <Switch checked={s.logTimestamps} onChange={(v) => save({ logTimestamps: v })} label={t('settings.logTimestamps')} />
            </div>
          </>
        )}
        <div style={{ marginTop: 8 }}>
          <button className="btn sm" onClick={() => api.OpenLogsDir()}>{t('settings.openLogsFolder')}</button>
        </div>
      </div>

      <div className="card">
        <h3>{t('settings.importExport')}</h3>
        <p className="muted" style={{ marginTop: 0 }}>{t('settings.importExportBody')}</p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setDlg('export')}>{t('settings.export')}</button>
          <button className="btn" onClick={pickImport}>{t('settings.importFromFile')}</button>
          <button className="btn" onClick={sshConfig}>{t('settings.importFromSSHConfig')}</button>
        </div>
      </div>

      <div className="card">
        <h3>{t('settings.security')}</h3>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setDlg('password')}>{t('settings.changePassword')}</button>
          <button className="btn" onClick={onLock}>{t('settings.lockNow')}</button>
          <button className="btn ghost" onClick={() => api.OpenDataDir()}>{t('settings.showVaultInFinder')}</button>
        </div>
      </div>

      {resumables.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <h3 style={{ padding: '16px 18px 0' }}>{t('settings.interruptedTransfers')}</h3>
          <p className="muted" style={{ padding: '0 18px', margin: '6px 0 0' }}>{t('settings.interruptedHint')}</p>
          {resumables.map((r) => (
            <div className="lrow" key={r.id}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{r.title}</div>
                <div className="muted mono ellipsis" style={{ fontSize: 11.5 }}>
                  {fmtSize(r.bytesDone)} / {fmtSize(r.total)} · {r.dstPath}
                </div>
              </div>
              <button className="icon-btn" title={t('settings.dismiss')} onClick={() => dismissResumable(r.id)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <h3 style={{ padding: '16px 18px 0' }}>{t('settings.trustedServers')}</h3>
        {data.knownHosts.length === 0 && <p className="muted" style={{ padding: '0 18px 16px', margin: '8px 0 0' }}>{t('settings.trustedServersEmpty')}</p>}
        {data.knownHosts.map((k) => (
          <div className="lrow" key={k.host + k.keyType}>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{k.host}</div>
              <div className="muted mono ellipsis" style={{ fontSize: 11.5 }}>{k.keyType} {k.fingerprint}</div>
            </div>
            <button className="icon-btn" title={t('settings.forget')} onClick={async () => { await api.ForgetKnownHost(k.host, k.keyType); reload() }}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

      <p className="faint" style={{ textAlign: 'center' }}>{t('settings.footer', { version: info.version, dir: info.dataDir })}</p>

      {dlg === 'export' && <ExportDialog data={data} onClose={() => setDlg(null)} />}
      {dlg === 'password' && <PasswordDialog onClose={() => setDlg(null)} />}
      {importPath && <ImportDialog path={importPath} onClose={() => setImportPath('')} onDone={reload} />}
    </div>
  )
}

function ExportDialog({ data, onClose }: { data: VaultData; onClose: () => void }) {
  const { t } = useI18n()
  const [everything, setEverything] = useState(true)
  const [sel, setSel] = useState<Selection>(emptySelection())
  const [secrets, setSecrets] = useState(false)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const payload: Selection = everything ? { ...emptySelection(), all: true, includeSecrets: secrets } : sel
      const path: string = await api.ExportFile(payload, pw)
      if (path) { toast(t('settings.savedTo', { path }), 'ok'); onClose() }
    } catch (e) { toast(errMsg(e), 'err') }
    finally { setBusy(false) }
  }
  const includeSecrets = everything ? secrets : sel.includeSecrets
  return (
    <Modal title={t('settings.exportTitle')} onClose={onClose} width={560}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={busy || (includeSecrets && !pw)} onClick={run}>{t('settings.saveFile')}</button></>}>
      <label className="check" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={everything} onChange={(e) => setEverything(e.target.checked)} />
        {t('settings.exportEverything')}
      </label>
      {everything ? (
        <label className="check" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={secrets} onChange={(e) => setSecrets(e.target.checked)} />
          {t('settings.includeSecrets')}
        </label>
      ) : (
        <SelectionPicker data={data} value={sel} onChange={setSel} />
      )}
      <Field label={includeSecrets ? t('settings.filePasswordRequired') : t('settings.filePasswordOptional')}
        hint={pw ? t('settings.filePasswordHintSet') : t('settings.filePasswordHintUnset')}>
        <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
    </Modal>
  )
}

function ImportDialog({ path, onClose, onDone }: { path: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n()
  const [encrypted, setEncrypted] = useState<boolean | null>(null)
  const [err, setErr] = useState('')
  const [pw, setPw] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.ImportInspect(path).then(setEncrypted).catch((e) => setErr(errMsg(e))) }, [path])

  const run = async () => {
    setBusy(true)
    try {
      const r = await api.ImportFile(path, pw, overwrite)
      toast(t('settings.importedResult', { summary: r.summary }), 'ok')
      onDone(); onClose()
    } catch (e) { toast(errMsg(e), 'err') }
    finally { setBusy(false) }
  }
  return (
    <Modal title={t('settings.importTitle')} onClose={onClose} width={480}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={busy || !!err || encrypted === null || (encrypted && !pw)} onClick={run}>{t('settings.importBtn')}</button></>}>
      <div className="code" style={{ marginBottom: 12 }}>{path}</div>
      {err && <div className="banner danger">{err}</div>}
      {encrypted && (
        <Field label={t('settings.filePassword')}>
          <input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && pw) run() }} />
        </Field>
      )}
      <label className="check">
        <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
        {t('settings.replaceExisting')}
      </label>
      <p className="hint">{t('settings.matchedById')}</p>
    </Modal>
  )
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [c, setC] = useState('')
  const run = async () => {
    if (b !== c) { toast(t('settings.passwordsNoMatch'), 'err'); return }
    try { await api.VaultChangePassword(a, b); toast(t('settings.passwordChanged'), 'ok'); onClose() }
    catch (e) { toast(errMsg(e), 'err') }
  }
  return (
    <Modal title={t('settings.changePasswordTitle')} onClose={onClose} width={420}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!a || b.length < 8} onClick={run}>{t('settings.change')}</button></>}>
      <Field label={t('settings.currentPassword')}><input className="input" type="password" autoFocus value={a} onChange={(e) => setA(e.target.value)} /></Field>
      <Field label={t('settings.newPassword')} hint={t('settings.newPasswordHint')}><input className="input" type="password" value={b} onChange={(e) => setB(e.target.value)} /></Field>
      <Field label={t('settings.repeatPassword')}><input className="input" type="password" value={c} onChange={(e) => setC(e.target.value)} /></Field>
    </Modal>
  )
}
