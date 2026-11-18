interface Props {
  checked: boolean
  onChange: (v: boolean) => void
  label?: React.ReactNode
}

export default function Switch({ checked, onChange, label }: Props) {
  return (
    <label className="switch-row">
      <button type="button" role="switch" aria-checked={checked} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
        <span className="switch-thumb" />
      </button>
      {label != null && <span className="switch-label">{label}</span>}
    </label>
  )
}
