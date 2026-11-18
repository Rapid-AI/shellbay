import { useEffect, useState } from 'react'

export interface ToastItem { id: number; msg: string; kind: 'ok' | 'err' | 'info' }
let items: ToastItem[] = []
let counter = 0
const subs = new Set<() => void>()

export function toast(msg: string, kind: ToastItem['kind'] = 'info', ms = 4200) {
  const id = ++counter
  items = [...items, { id, msg, kind }]
  subs.forEach((f) => f())
  setTimeout(() => {
    items = items.filter((t) => t.id !== id)
    subs.forEach((f) => f())
  }, ms)
}

export function useToasts(): ToastItem[] {
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force((n) => n + 1)
    subs.add(f)
    return () => { subs.delete(f) }
  }, [])
  return items
}
