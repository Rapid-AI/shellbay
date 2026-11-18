// JavaScript plugins run in Web Workers. Workers have no DOM or Wails
// bridge, but can use networking APIs. Dictionary plugins are plain data
// and never create a Worker. Both supply the same suggestion objects.

export interface PluginManifest {
  id: string
  name: string
  version: string
  author?: string
  capabilities: string[]
  code?: string
  commands?: Record<string, PluginSuggestion[]>
}

export interface PluginSuggestion { flag: string; desc: string }

interface SuggestContext { command: string; partial: string }

// Runs inside the Worker, ahead of the plugin's own code. Defines the one
// registration API v1 supports and the message-dispatch loop. Kept as a
// plain string (not a separate .js asset) so a plugin Worker can be built
// from a single Blob with no extra file to ship/fetch.
const WORKER_WRAPPER = `
let suggestSource = null;
const shellbay = {
  registerSuggestSource(fn) { suggestSource = fn; },
};
self.onmessage = async (ev) => {
  const { id, type, payload } = ev.data;
  try {
    if (type === 'suggest.commands') {
      const result = suggestSource ? await suggestSource(payload) : [];
      self.postMessage({ id, result: Array.isArray(result) ? result : [] });
    } else {
      self.postMessage({ id, result: [] });
    }
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
`

const INVOKE_TIMEOUT_MS = 300

// One sandboxed Worker for one installed plugin.
class PluginHost {
  private worker: Worker
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void }>()

  constructor(code: string) {
    // The second argument keeps pre-rename plugins working.
    const blob = new Blob([WORKER_WRAPPER + '\n;(function(shellbay, harbor){\n' + code + '\n})(shellbay, shellbay);'], {
      type: 'application/javascript',
    })
    const url = URL.createObjectURL(blob)
    try {
      this.worker = new Worker(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    this.worker.onmessage = (ev) => {
      const { id, result, error } = ev.data ?? {}
      const p = this.pending.get(id)
      if (!p) return
      this.pending.delete(id)
      p.resolve(error ? [] : result)
    }
    this.worker.onerror = () => { /* a broken plugin just yields no suggestions */ }
  }

  private invoke(type: string, payload: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, { resolve })
      this.worker.postMessage({ id, type, payload })
      setTimeout(() => {
        if (this.pending.delete(id)) resolve([])
      }, INVOKE_TIMEOUT_MS)
    })
  }

  suggestCommands(ctx: SuggestContext): Promise<PluginSuggestion[]> {
    return this.invoke('suggest.commands', ctx) as Promise<PluginSuggestion[]>
  }

  dispose() {
    this.worker.onmessage = null
    this.worker.onerror = null
    this.worker.terminate()
  }
}

// Module-level manager: App.tsx calls reload() whenever the installed-plugin
// list or the disabled-ids setting changes; any component can import
// `plugins` and call getCommandSuggestions directly, same pattern as `api`/
// `toast` elsewhere in this codebase.
class PluginManager {
  private hosts: PluginHost[] = []
  private dictionaries: NonNullable<PluginManifest['commands']>[] = []

  reload(manifests: PluginManifest[], disabledIds: string[]) {
    for (const h of this.hosts) h.dispose()
    const disabled = new Set(disabledIds)
    this.hosts = []
    this.dictionaries = []
    for (const manifest of manifests) {
      if (disabled.has(manifest.id) || !manifest.capabilities.includes('suggest.commands')) continue
      if (manifest.commands) this.dictionaries.push(manifest.commands)
      if (manifest.code) {
        try { this.hosts.push(new PluginHost(manifest.code)) } catch { /* Worker unavailable */ }
      }
    }
  }

  async getCommandSuggestions(command: string, partial: string): Promise<PluginSuggestion[]> {
    // Dictionaries supply static data directly. A failed Worker can time out
    // without losing results from the dictionaries or from other Workers.
    const out = this.dictionaries.flatMap((dictionary) =>
      Object.prototype.hasOwnProperty.call(dictionary, command) ? dictionary[command] : [])
    const results = await Promise.allSettled(this.hosts.map((h) => h.suggestCommands({ command, partial })))
    for (const r of results) if (r.status === 'fulfilled') out.push(...r.value)
    return out
  }
}

export const plugins = new PluginManager()
