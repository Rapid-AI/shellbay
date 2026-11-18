import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n'
import type { FlagSuggestion } from '../termSuggest'

export default function TermSuggest({ suggestions, selected }: { suggestions: FlagSuggestion[]; selected: number }) {
  const { t } = useI18n()
  const rowRef = useRef<HTMLDivElement>(null)
  const chipRefs = useRef<Record<number, HTMLSpanElement | null>>({})
  useEffect(() => {
    chipRefs.current[selected]?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [selected, suggestions])
  if (!suggestions.length) return null
  return (
    <div className="term-suggest">
      <div className="term-suggest-row" ref={rowRef}>
        {suggestions.map((s, i) => (
          <span className={`term-suggest-chip ${i === selected ? 'on' : ''}`} key={s.flag}
            ref={(el) => { chipRefs.current[i] = el }}>
            <b>{s.flag}</b>{s.desc && <span className="faint"> {s.desc}</span>}
          </span>
        ))}
      </div>
      <span className="term-suggest-hint faint">{t('term.suggestHint')}</span>
    </div>
  )
}
