type Fn = (...a: any[]) => Promise<any>

// Wails injects window.go.main.App.<Method> for every exported Go method.
export const api: Record<string, Fn> = new Proxy({} as Record<string, Fn>, {
  get: (_t, name: string) => (...args: any[]) => (window as any).go.main.App[name](...args),
})

export const on = (ev: string, cb: (d?: any) => void): (() => void) =>
  (window as any).runtime.EventsOn(ev, cb)

export const openURL = (u: string) => (window as any).runtime.BrowserOpenURL(u)

export const errMsg = (e: any): string =>
  typeof e === 'string' ? e : e?.message ? String(e.message) : String(e)

export const uid = () => Math.random().toString(36).slice(2, 10)

// Resolves once the Wails bridge has been injected into the page.
export function whenReady(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      const w = window as any
      if (w.go?.main?.App && w.runtime) resolve()
      else setTimeout(check, 30)
    }
    check()
  })
}
