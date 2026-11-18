// Small, hand-drawn OS glyphs for host cards. lucide-react is a generic
// icon set and deliberately has no brand/OS logos, so these are minimal
// inline SVGs instead of a dependency.
export default function OsIcon({ os, size = 13 }: { os: string; size?: number }) {
  const s = { width: size, height: size, flex: 'none' as const, display: 'block' as const }
  let label = 'Unknown OS'
  let svg: JSX.Element
  switch (os) {
    case 'linux':
      label = 'Linux'
      svg = (
        <svg viewBox="0 0 24 24" style={s} fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="10" r="5.5" />
          <path d="M8 15c-1 2-1 4.5 1 6.5M16 15c1 2 1 4.5-1 6.5M9 21.5h6" strokeLinecap="round" />
          <circle cx="9.8" cy="9" r=".9" fill="currentColor" stroke="none" />
          <circle cx="14.2" cy="9" r=".9" fill="currentColor" stroke="none" />
        </svg>
      )
      break
    case 'darwin':
      label = 'macOS'
      svg = (
        <svg viewBox="0 0 24 24" style={s} fill="currentColor">
          <path d="M17.4 12.6c0-2 1-3.1 2.1-3.8-.9-1.3-2.3-2-3.9-2-1.2 0-2.3.6-3.1.6-.9 0-2-.6-3.2-.6-2.3 0-4.8 1.9-4.8 5.5 0 3.4 2.4 7.7 4.2 7.7 1 0 1.4-.6 2.6-.6 1.2 0 1.5.6 2.6.6 1.5 0 3.2-2.6 4-4.6-1.5-.6-2.5-1.9-2.5-2.8Z" />
          <path d="M14.6 4.3c.6-.8 1-1.8.9-2.9-1 .1-2.1.7-2.7 1.5-.6.7-1.1 1.8-.9 2.8 1 .1 2.1-.6 2.7-1.4Z" />
        </svg>
      )
      break
    case 'windows':
      label = 'Windows'
      svg = (
        <svg viewBox="0 0 24 24" style={s} fill="currentColor">
          <path d="M3 5.5 11 4.4v7.1H3V5.5Zm0 13L11 19.6v-7.1H3v6ZM12 4.3 21 3v8.5h-9V4.3Zm0 8.2h9V20L12 18.7v-6.2Z" />
        </svg>
      )
      break
    case 'bsd':
      label = 'BSD'
      svg = (
        <svg viewBox="0 0 24 24" style={s} fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9c0 2 1.5 3 3 3s3 1 3 3M9 15c0-2 1.5-3 3-3" strokeLinecap="round" />
        </svg>
      )
      break
    default:
      svg = (
        <svg viewBox="0 0 24 24" style={s} fill="none" stroke="currentColor" strokeWidth="1.6" opacity={0.55}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v.01M12 13c0-1.5 2-1.6 2-3.3 0-1.3-1-2.2-2.3-2.2-1.1 0-2 .6-2.4 1.6" strokeLinecap="round" />
        </svg>
      )
  }
  return <span title={label} style={{ display: 'flex' }}>{svg}</span>
}
