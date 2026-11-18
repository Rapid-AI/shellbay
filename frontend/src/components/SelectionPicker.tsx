import { useI18n } from '../i18n'
import type { Selection, VaultData } from '../types'

type Field = 'hostIds' | 'keyIds' | 'snippetIds' | 'flowIds' | 'forwardIds'

export const emptySelection = (): Selection => ({
  all: false, hostIds: [], keyIds: [], snippetIds: [], flowIds: [], forwardIds: [], includeSecrets: false,
})

interface Props {
  data: VaultData
  value: Selection
  onChange: (s: Selection) => void
}

export default function SelectionPicker({ data, value, onChange }: Props) {
  const { t } = useI18n()
  const toggle = (f: Field, id: string) =>
    onChange({ ...value, [f]: value[f].includes(id) ? value[f].filter((x) => x !== id) : [...value[f], id] })
  const toggleAll = (f: Field, ids: string[]) =>
    onChange({ ...value, [f]: value[f].length === ids.length ? [] : ids })

  const section = (title: string, f: Field, items: { id: string; label: string; sub?: string }[]) => (
    <div className="field" key={f}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <label>{title} <span className="faint">({value[f].length}/{items.length})</span></label>
        {items.length > 0 && (
          <button className="btn ghost sm" onClick={() => toggleAll(f, items.map((i) => i.id))}>
            {value[f].length === items.length ? t('sel.clear') : t('sel.selectAll')}
          </button>
        )}
      </div>
      <div className="pickbox">
        {items.length === 0 && <span className="muted">{t('sel.nothingHere')}</span>}
        {items.map((i) => (
          <label className="check" key={i.id}>
            <input type="checkbox" checked={value[f].includes(i.id)} onChange={() => toggle(f, i.id)} />
            <span className="ellipsis">{i.label}</span>
            {i.sub && <span className="faint ellipsis">{i.sub}</span>}
          </label>
        ))}
      </div>
    </div>
  )

  return (
    <div>
      {section(t('sel.hosts'), 'hostIds', data.hosts.map((h) => ({ id: h.id, label: h.label, sub: `${h.username}@${h.address}` })))}
      {section(t('sel.snippets'), 'snippetIds', data.snippets.map((s) => ({ id: s.id, label: s.name })))}
      {section(t('sel.flows'), 'flowIds', data.flows.map((f) => ({ id: f.id, label: f.name })))}
      {section(t('sel.forwardRules'), 'forwardIds', data.forwards.map((f) => ({ id: f.id, label: f.name })))}
      <label className="check" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={value.includeSecrets}
          onChange={(e) => onChange({ ...value, includeSecrets: e.target.checked })} />
        {t('sel.includeSecrets')}
      </label>
      {value.includeSecrets && (
        <>
          <div className="banner warn">{t('sel.secretsWarning')}</div>
          {section(t('sel.extraKeys'), 'keyIds', data.keys.map((k) => ({ id: k.id, label: k.name, sub: k.type })))}
        </>
      )}
      <p className="hint" style={{ marginTop: 0 }}>{t('sel.jumpHostsHint')}</p>
    </div>
  )
}
