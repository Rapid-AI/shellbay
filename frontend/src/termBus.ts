import { on } from './api'

// One subscription receives output for every terminal. Buffer output until
// its xterm view attaches so fast commands cannot lose their first bytes.
const sinks = new Map<string, (d: Uint8Array) => void>()
const closers = new Map<string, (reason: string) => void>()
const buffers = new Map<string, Uint8Array[]>()
const pendingClose = new Map<string, string>()
export const live = new Set<string>()

function decode(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

let started = false
export function initBus() {
  if (started) return
  started = true
  on('term:data', (m: any) => {
    const u = decode(m.data)
    const s = sinks.get(m.id)
    if (s) { s(u); return }
    const b = buffers.get(m.id) ?? []
    b.push(u)
    buffers.set(m.id, b)
  })
  on('term:close', (m: any) => {
    const c = closers.get(m.id)
    if (c) c(m.reason)
    else pendingClose.set(m.id, m.reason)
  })
}

export function attach(id: string, sink: (d: Uint8Array) => void, onClose: (reason: string) => void) {
  sinks.set(id, sink)
  closers.set(id, onClose)
  live.add(id)
  const buf = buffers.get(id)
  if (buf) { buf.forEach(sink); buffers.delete(id) }
  const pc = pendingClose.get(id)
  if (pc !== undefined) { pendingClose.delete(id); onClose(pc) }
}

export function detach(id: string) {
  sinks.delete(id)
  closers.delete(id)
  buffers.delete(id)
  live.delete(id)
}
