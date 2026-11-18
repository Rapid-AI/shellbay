import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { api, errMsg } from '../api'
import { toast } from '../toast'
import { fmtSize } from '../util'
import { useI18n } from '../i18n'
import type { SyncAction } from '../types'

interface Dlg {
  srcFs: string; srcDir: string; srcLabel: string
  dstFs: string; dstDir: string; dstLabel: string
}

export default function SyncDialog({ dlg, onClose, onDone }: { dlg: Dlg; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n()
  const LABEL: Record<SyncAction['kind'], string> = { add: t('sync.add'), update: t('sync.update'), remove: t('sync.remove') }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actions, setActions] = useState<SyncAction[]>([])
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [running, setRunning] = useState(false)

  useEffect(() => {
    api.FsSyncPreview(dlg.srcFs, dlg.dstFs, dlg.srcDir, dlg.dstDir)
      .then((acts: SyncAction[]) => {
        setActions(acts)
        const init: Record<string, boolean> = {}
        acts.forEach((a) => { init[a.path] = a.kind !== 'remove' }) // mirroring deletes is opt-in
        setChecked(init)
      })
      .catch((e: any) => setError(errMsg(e)))
      .finally(() => setLoading(false))
  }, [dlg.srcFs, dlg.dstFs, dlg.srcDir, dlg.dstDir])

  const selected = useMemo(() => actions.filter((a) => checked[a.path]), [actions, checked])
  const groups = useMemo(() => ({
    add: actions.filter((a) => a.kind === 'add'),
    update: actions.filter((a) => a.kind === 'update'),
    remove: actions.filter((a) => a.kind === 'remove'),
  }), [actions])

  const apply = async () => {
    if (!selected.length) { onClose(); return }
    setRunning(true)
    try {
      await api.FsSyncApply(dlg.srcFs, dlg.dstFs, dlg.srcDir, dlg.dstDir, selected)
      onClose()
      onDone()
    } catch (e) {
      toast(errMsg(e), 'err')
      setRunning(false)
    }
  }

  return (
    <Modal title={t('sync.title')} onClose={onClose} width={560}
      footer={<>
        <button className="btn left" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={loading || running || !selected.length} onClick={apply}>
          {running ? t('sync.applying') : t('sync.apply', { n: selected.length })}
        </button>
      </>}>
      <p className="hint" style={{ marginTop: 0 }}>
        {t('sync.description', { dst: dlg.dstLabel, src: dlg.srcLabel })}
      </p>
      {loading && <p className="muted">{t('sync.comparing')}</p>}
      {error && <div className="banner err">{error}</div>}
      {!loading && !error && !actions.length && <p className="muted">{t('sync.alreadyMatch')}</p>}
      {!loading && !error && (['add', 'update', 'remove'] as const).map((kind) => groups[kind].length > 0 && (
        <div className="field" key={kind}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label>{LABEL[kind]} <span className="faint">({groups[kind].length})</span></label>
            <button className="btn ghost sm" onClick={() => {
              const all = groups[kind].every((a) => checked[a.path])
              setChecked((c) => {
                const n = { ...c }
                groups[kind].forEach((a) => { n[a.path] = !all })
                return n
              })
            }}>
              {groups[kind].every((a) => checked[a.path]) ? t('sel.clear') : t('sel.selectAll')}
            </button>
          </div>
          <div className="pickbox">
            {groups[kind].map((a) => (
              <label className="check" key={a.path}>
                <input type="checkbox" checked={!!checked[a.path]}
                  onChange={() => setChecked((c) => ({ ...c, [a.path]: !c[a.path] }))} />
                <span className="ellipsis mono">{a.path}</span>
                <span className="faint">{fmtSize(a.size)}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  )
}
