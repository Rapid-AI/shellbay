import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import Modal, { Confirm, Field } from './Modal'
import { api, errMsg, on } from '../api'
import { toast } from '../toast'
import { useI18n } from '../i18n'
import type { Flow, FlowStep, FlowStepKind, VaultData } from '../types'

const KINDS: FlowStepKind[] = ['send', 'wait', 'pause', 'upload', 'download', 'condition', 'prompt', 'script']

function emptyStep(kind: FlowStepKind): FlowStep {
  return {
    id: '', kind, text: '', appendEnter: true, pattern: '', timeoutMs: 15000, onNoMatchGoto: -1,
    durationMs: 1000, localPath: '', remotePath: '', varName: '', message: '', secret: false,
    lang: 'js', code: '',
  }
}

export default function Flows({ data, reload }: { data: VaultData; reload: () => void }) {
  const { t } = useI18n()
  const [edit, setEdit] = useState<Flow | null>(null)
  const [del, setDel] = useState<Flow | null>(null)
  const [runFlow, setRunFlow] = useState<Flow | null>(null)

  return (
    <div className="view">
      <div className="page-head">
        <h1>{t('flow.title')}</h1>
        <span className="sub">{t('flow.subtitle')}</span>
        <span className="grow" />
        <button className="btn primary" onClick={() => setEdit({ id: '', name: '', tags: [], steps: [] })}><Plus size={15} /> {t('flow.newFlow')}</button>
      </div>
      {data.flows.length === 0 && (
        <div className="empty"><h3>{t('flow.emptyTitle')}</h3><p>{t('flow.emptyBody')}</p></div>
      )}
      {data.flows.length > 0 && (
        <div className="list">
          {data.flows.map((f) => (
            <div className="lrow" key={f.id}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{f.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>{t('flow.stepsCount', { n: f.steps.length })}</div>
              </div>
              <button className="btn sm primary" onClick={() => setRunFlow(f)}><Play size={12} /> {t('flow.run')}</button>
              <button className="icon-btn" onClick={() => setEdit(f)}><Pencil size={15} /></button>
              <button className="icon-btn" onClick={() => setDel(f)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
      {edit && <FlowEditor flow={edit} onClose={() => setEdit(null)} onSaved={reload} />}
      {del && (
        <Confirm title={t('flow.deleteTitle')} danger confirm={t('flow.deleteConfirm')} onClose={() => setDel(null)}
          onConfirm={async () => { await api.DeleteFlow(del.id); reload() }}>
          <p style={{ marginTop: 0 }}>{t('flow.deleteBody', { name: del.name })}</p>
        </Confirm>
      )}
      {runFlow && <RunDialog flow={runFlow} data={data} onClose={() => setRunFlow(null)} />}
    </div>
  )
}

function FlowEditor({ flow, onClose, onSaved }: { flow: Flow; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const [name, setName] = useState(flow.name)
  const [steps, setSteps] = useState<FlowStep[]>(flow.steps)
  const [busy, setBusy] = useState(false)

  const addStep = () => setSteps((s) => [...s, emptyStep('send')])
  const updateStep = (i: number, patch: Partial<FlowStep>) => setSteps((s) => s.map((st, k) => (k === i ? { ...st, ...patch } : st)))
  const removeStep = (i: number) => setSteps((s) => s.filter((_, k) => k !== i))
  const moveStep = (i: number, dir: -1 | 1) => setSteps((s) => {
    const j = i + dir
    if (j < 0 || j >= s.length) return s
    const copy = [...s]
    const tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp
    return copy
  })

  const save = async () => {
    setBusy(true)
    try {
      await api.SaveFlow({ ...flow, name: name.trim() || 'Untitled flow', steps })
      onSaved(); onClose()
    } catch (e) { toast(errMsg(e), 'err') }
    finally { setBusy(false) }
  }

  return (
    <Modal title={flow.id ? t('flow.editTitle') : t('flow.newTitle')} onClose={onClose} width={680}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={busy || !name.trim()} onClick={save}>{t('common.save')}</button></>}>
      <Field label={t('flow.name')}><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <p className="hint" style={{ marginTop: -6 }}>{t('flow.varsHint')}</p>
      <div className="flow-steps">
        {steps.map((st, i) => (
          <FlowStepCard key={i} index={i} step={st} total={steps.length}
            onChange={(patch) => updateStep(i, patch)} onRemove={() => removeStep(i)} onMove={(dir) => moveStep(i, dir)} />
        ))}
      </div>
      <button className="btn ghost sm" onClick={addStep}><Plus size={13} /> {t('flow.addStep')}</button>
    </Modal>
  )
}

function FlowStepCard({ index, step, total, onChange, onRemove, onMove }: {
  index: number; step: FlowStep; total: number
  onChange: (patch: Partial<FlowStep>) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void
}) {
  const { t } = useI18n()
  const kindLabel: Record<FlowStepKind, string> = {
    send: t('flow.kindSend'), wait: t('flow.kindWait'), pause: t('flow.kindPause'),
    upload: t('flow.kindUpload'), download: t('flow.kindDownload'), condition: t('flow.kindCondition'),
    prompt: t('flow.kindPrompt'), script: t('flow.kindScript'),
  }
  return (
    <div className="flow-step">
      <div className="flow-step-head">
        <b>{index + 1}.</b>
        <select className="input" style={{ width: 'auto', flex: 1 }} value={step.kind}
          onChange={(e) => onChange({ kind: e.target.value as FlowStepKind })}>
          {KINDS.map((k) => <option key={k} value={k}>{kindLabel[k]}</option>)}
        </select>
        <button className="icon-btn" disabled={index === 0} onClick={() => onMove(-1)} title={t('flow.moveUp')}><ChevronUp size={14} /></button>
        <button className="icon-btn" disabled={index === total - 1} onClick={() => onMove(1)} title={t('flow.moveDown')}><ChevronDown size={14} /></button>
        <button className="icon-btn" onClick={onRemove} title={t('flow.removeStep')}><X size={14} /></button>
      </div>
      <div className="flow-step-body">
        {step.kind === 'send' && (
          <>
            <Field label={t('flow.text')}><input className="input mono" value={step.text} onChange={(e) => onChange({ text: e.target.value })} /></Field>
            <label className="check">
              <input type="checkbox" checked={step.appendEnter} onChange={(e) => onChange({ appendEnter: e.target.checked })} /> {t('flow.appendEnter')}
            </label>
          </>
        )}
        {(step.kind === 'wait' || step.kind === 'condition') && (
          <div className="row">
            <Field label={t('flow.pattern')}><input className="input mono" value={step.pattern} onChange={(e) => onChange({ pattern: e.target.value })} /></Field>
            <div style={{ width: 110 }}><Field label={t('flow.timeoutMs')}>
              <input className="input" inputMode="numeric" value={step.timeoutMs}
                onChange={(e) => onChange({ timeoutMs: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
            </Field></div>
          </div>
        )}
        {step.kind === 'condition' && (
          <Field label={t('flow.onNoMatchGoto')}>
            <input className="input" value={step.onNoMatchGoto}
              onChange={(e) => onChange({ onNoMatchGoto: parseInt(e.target.value.replace(/[^-\d]/g, ''), 10) || 0 })} />
          </Field>
        )}
        {step.kind === 'pause' && (
          <Field label={t('flow.durationMs')}>
            <input className="input" inputMode="numeric" value={step.durationMs} onChange={(e) => onChange({ durationMs: Number(e.target.value.replace(/\D/g, '')) })} />
          </Field>
        )}
        {(step.kind === 'upload' || step.kind === 'download') && (
          <div className="row">
            <Field label={t('flow.localPath')}><input className="input mono" value={step.localPath} onChange={(e) => onChange({ localPath: e.target.value })} /></Field>
            <Field label={t('flow.remotePath')}><input className="input mono" value={step.remotePath} onChange={(e) => onChange({ remotePath: e.target.value })} /></Field>
          </div>
        )}
        {step.kind === 'prompt' && (
          <>
            <div className="row">
              <Field label={t('flow.varName')}><input className="input mono" value={step.varName} onChange={(e) => onChange({ varName: e.target.value })} /></Field>
              <Field label={t('flow.message')}><input className="input" value={step.message} onChange={(e) => onChange({ message: e.target.value })} /></Field>
            </div>
            <label className="check">
              <input type="checkbox" checked={step.secret} onChange={(e) => onChange({ secret: e.target.checked })} /> {t('flow.secret')}
            </label>
          </>
        )}
        {step.kind === 'script' && (
          <>
            <div className="field"><label>{t('flow.lang')}</label>
              <div className="seg" style={{ alignSelf: 'flex-start' }}>
                <button className={step.lang === 'js' ? 'on' : ''} onClick={() => onChange({ lang: 'js' })}>JavaScript</button>
                <button className={step.lang === 'lua' ? 'on' : ''} onClick={() => onChange({ lang: 'lua' })}>Lua</button>
              </div>
            </div>
            <Field label={t('flow.code')}>
              <textarea className="input mono" style={{ minHeight: 100 }} value={step.code} onChange={(e) => onChange({ code: e.target.value })} />
            </Field>
          </>
        )}
      </div>
    </div>
  )
}

function RunDialog({ flow, data, onClose }: { flow: Flow; data: VaultData; onClose: () => void }) {
  const { t } = useI18n()
  const [hostId, setHostId] = useState(data.hosts[0]?.id ?? '')
  const [runId, setRunId] = useState<string | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const runIdRef = useRef<string | null>(null)

  // Subscribed once: FlowRun's background goroutine can start emitting
  // flow:output before the "start a run" call below even resolves, so
  // filtering must use a ref set synchronously rather than depend on a
  // re-render to pick up the new run ID (which could lose the first lines).
  useEffect(() => {
    const offs = [
      on('flow:output', (m: any) => { if (m.runId === runIdRef.current) setLines((l) => [...l, m.line]) }),
      on('flow:done', (m: any) => {
        if (m.runId !== runIdRef.current) return
        setState(m.error ? 'error' : 'done')
        setError(m.error || '')
      }),
    ]
    return () => offs.forEach((f) => f())
  }, [])

  const start = async () => {
    setLines([]); setError(''); setState('running')
    try {
      const id: string = await api.FlowRun(flow.id, hostId)
      runIdRef.current = id
      setRunId(id)
    } catch (e) { setState('error'); setError(errMsg(e)) }
  }
  const stop = () => { if (runId) api.FlowStop(runId) }

  return (
    <Modal title={t('flow.runTitle', { name: flow.name })} onClose={onClose} width={620}
      footer={<>
        <button className="btn left" onClick={onClose}>{t('common.close')}</button>
        {state === 'running'
          ? <button className="btn danger" onClick={stop}>{t('flow.stop')}</button>
          : <button className="btn primary" disabled={!hostId} onClick={start}>{t('flow.runBtn')}</button>}
      </>}>
      {!data.hosts.length ? <p className="muted" style={{ margin: 0 }}>{t('flow.noHosts')}</p> : (
        <Field label={t('flow.chooseHost')}>
          <select className="input" value={hostId} onChange={(e) => setHostId(e.target.value)} disabled={state === 'running'}>
            {data.hosts.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
          </select>
        </Field>
      )}
      <div className="flow-output mono">
        {lines.length === 0 && state === 'idle' && <span className="muted">—</span>}
        {lines.map((l, i) => <div key={i}>{l}</div>)}
        {state === 'running' && <div className="muted">{t('flow.running')}</div>}
        {state === 'done' && <div className="ok">{t('flow.finished')}</div>}
        {state === 'error' && <div className="err">{t('flow.failed', { error })}</div>}
      </div>
    </Modal>
  )
}
