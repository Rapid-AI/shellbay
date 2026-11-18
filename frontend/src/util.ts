export function fmtSize(n: number): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`
}

export function fmtSpeed(bps: number): string {
  return bps > 0 ? `${fmtSize(bps)}/s` : ''
}

export function fmtDate(ms: number, locale = 'en'): string {
  if (!ms) return ''
  const d = new Date(ms)
  const now = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  const date = `${d.getDate()} ${d.toLocaleString(locale, { month: 'short' })}`
  return d.getFullYear() === now.getFullYear()
    ? `${date} ${p(d.getHours())}:${p(d.getMinutes())}`
    : `${date} ${d.getFullYear()}`
}

export function dirname(p: string): string {
  if (p === '/' || p === '') return '/'
  const t = p.replace(/\/+$/, '')
  const i = t.lastIndexOf('/')
  return i <= 0 ? '/' : t.slice(0, i)
}

export function basename(p: string): string {
  const t = p.replace(/\/+$/, '')
  return t.slice(t.lastIndexOf('/') + 1) || '/'
}

export function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir.replace(/\/+$/, '')}/${name}`
}

export function initials(label: string): string {
  const parts = label.trim().split(/[\s._-]+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function groupFingerprint(hex: string): string {
  return (hex || '').slice(0, 32).replace(/(.{4})/g, '$1 ').trim()
}

export const HOST_COLORS = ['#5b8cff', '#46d39a', '#f0b95b', '#ff6b7d', '#c792ea', '#4fd1e8', '#9aa5c4']
