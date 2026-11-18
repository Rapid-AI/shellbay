export interface Group { id: string; name: string }
export interface Host {
  id: string; label: string; address: string; port: number; username: string
  authType: 'password' | 'key' | 'agent'; password: string; keyId: string; groupId: string
  tags: string[]; jumpHostId: string; startupCommand: string; note: string; color: string
  protocol: 'ssh' | 'ftp'; os: string; favorite: boolean
  createdAt: number; lastUsedAt: number
}
export interface PingResult { reachable: boolean; ms: number }
export interface Key {
  id: string; name: string; type: string; privateKey: string; publicKey: string
  passphrase: string; fingerprint: string; createdAt: number
}
export interface Snippet { id: string; name: string; command: string; tags: string[] }
export type FlowStepKind = 'send' | 'wait' | 'pause' | 'upload' | 'download' | 'condition' | 'prompt' | 'script'
export interface FlowStep {
  id: string; kind: FlowStepKind
  text: string; appendEnter: boolean
  pattern: string; timeoutMs: number; onNoMatchGoto: number
  durationMs: number
  localPath: string; remotePath: string
  varName: string; message: string; secret: boolean
  lang: 'js' | 'lua'; code: string
}
export interface Flow { id: string; name: string; tags: string[]; steps: FlowStep[] }
export interface CommandStat { command: string; flag: string; count: number; lastUsedAt: number }
export interface Forward {
  id: string; name: string; type: 'local' | 'remote' | 'dynamic'; hostId: string
  bindAddr: string; bindPort: number; destAddr: string; destPort: number
}
export interface KnownHost { host: string; keyType: string; fingerprint: string; publicKey: string; addedAt: number }
export interface Peer { id: string; name: string; address: string; fingerprint: string; addedAt: number; lastSeenAt: number }
export interface Settings {
  theme: string; fontSize: number; fontFamily: string; scrollback: number; cursorStyle: 'block' | 'bar' | 'underline'
  logSessions: boolean; logFormat: 'raw' | 'plain'; logTimestamps: boolean
  keepAliveSec: number; shareEnabled: boolean; sharePort: number; language: string
  uiTheme: 'light' | 'dark' | 'system'
  uiThemeId: string
  disabledPluginIds: string[]
}
export interface LogInfo { name: string; label: string; size: number; modTime: number }
export interface VaultData {
  groups: Group[]; hosts: Host[]; keys: Key[]; snippets: Snippet[]; flows: Flow[]; commandStats: CommandStat[]; forwards: Forward[]
  knownHosts: KnownHost[]; peers: Peer[]; identity: { deviceName: string }; settings: Settings
}
export interface Entry {
  name: string; path: string; size: number; isDir: boolean; isLink: boolean
  mode: number; modeStr: string; modTime: number; owner: string
}
export interface Job {
  id: string; title: string; state: 'queued' | 'planning' | 'running' | 'done' | 'error' | 'canceled'
  total: number; done: number; files: number; filesDone: number; current: string; error: string
  speed: number; move: boolean; srcFs: string; dstFs: string; dstDir: string; startedAt: number; endedAt: number
  resumable: boolean; srcPath: string; dstPath: string
}
export interface Selection {
  all: boolean; hostIds: string[]; keyIds: string[]; snippetIds: string[]; flowIds: string[]; forwardIds: string[]; includeSecrets: boolean
}
export interface SyncAction { kind: 'add' | 'update' | 'remove'; path: string; size: number }
export interface ResumableRecord {
  id: string; title: string; srcHostId: string; dstHostId: string; srcPath: string; dstPath: string
  bytesDone: number; total: number; move: boolean; savedAt: number
}
export type TabKind = 'terminal' | 'local' | 'sftp'
export interface Tab { id: string; kind: TabKind; title: string; hostId?: string; color?: string }
