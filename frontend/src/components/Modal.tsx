import { ReactNode, useEffect, useState } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { useI18n } from '../i18n'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
  height?: number
  maximizable?: boolean
  headExtra?: ReactNode
}

export default function Modal({ title, onClose, children, footer, width = 520, height, maximizable, headExtra }: Props) {
  const { t } = useI18n()
  const [max, setMax] = useState(false)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal ${max ? 'maximized' : ''}`} style={max ? undefined : { width, height }}>
        <div className="modal-head">
          <h3 className="ellipsis">{title}</h3>
          {headExtra}
          {maximizable && (
            <button className="icon-btn" onClick={() => setMax((m) => !m)} title={max ? t('common.restore') : t('common.maximize')}>
              {max ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          )}
          <button className="icon-btn" onClick={onClose} title={t('common.close')}><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

export function TextPrompt(props: {
  title: string
  label: string
  initial?: string
  confirm: string
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [v, setV] = useState(props.initial ?? '')
  const submit = () => { if (v.trim()) props.onSubmit(v.trim()) }
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      width={420}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={submit} disabled={!v.trim()}>{props.confirm}</button>
        </>
      }
    >
      <Field label={props.label}>
        <input
          className="input"
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
      </Field>
    </Modal>
  )
}

export function Confirm(props: {
  title: string
  children: ReactNode
  confirm: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      width={440}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>{t('common.cancel')}</button>
          <button
            className={`btn ${props.danger ? 'danger' : 'primary'}`}
            autoFocus
            onClick={() => { props.onConfirm(); props.onClose() }}
          >
            {props.confirm}
          </button>
        </>
      }
    >
      {props.children}
    </Modal>
  )
}
