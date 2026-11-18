import { useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}

export default function TagInput({ value, onChange, placeholder }: Props) {
  const [draft, setDraft] = useState('')

  const add = (raw: string) => {
    const tag = raw.trim()
    if (!tag) return
    if (!value.includes(tag)) onChange([...value, tag])
    setDraft('')
  }
  const removeAt = (i: number) => onChange(value.filter((_, k) => k !== i))

  return (
    <div className="tag-input">
      {value.map((tag, i) => (
        <span className="tag-chip" key={tag + i}>
          {tag}
          <button type="button" onClick={() => removeAt(i)}><X size={11} /></button>
        </span>
      ))}
      <input
        className="tag-input-field"
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => {
          const v = e.target.value
          if (v.endsWith(',')) add(v.slice(0, -1))
          else setDraft(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(draft) }
          else if (e.key === 'Backspace' && !draft && value.length) removeAt(value.length - 1)
        }}
        onBlur={() => add(draft)}
      />
    </div>
  )
}
