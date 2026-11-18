import { useToasts } from '../toast'

export default function Toasts() {
  const items = useToasts()
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>
      ))}
    </div>
  )
}
