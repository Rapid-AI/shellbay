import type { Extension } from '@codemirror/state'

export type LanguageId =
  | 'plain' | 'javascript' | 'jsx' | 'typescript' | 'tsx' | 'python' | 'json' | 'html' | 'css'
  | 'markdown' | 'sql' | 'yaml' | 'xml' | 'go' | 'rust' | 'c' | 'cpp' | 'java' | 'php'
  | 'shell' | 'ruby' | 'perl' | 'lua' | 'toml' | 'ini' | 'dockerfile' | 'nginx'

// "Plain text" is listed first and is a real, deliberate choice (no
// highlighting at all), not just a silent fallback.
export const LANGUAGES: { id: LanguageId; label: string }[] = [
  { id: 'plain', label: 'Plain text (no highlighting)' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'jsx', label: 'JSX' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'tsx', label: 'TSX' },
  { id: 'python', label: 'Python' },
  { id: 'json', label: 'JSON' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'sql', label: 'SQL' },
  { id: 'yaml', label: 'YAML' },
  { id: 'xml', label: 'XML' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'java', label: 'Java' },
  { id: 'php', label: 'PHP' },
  { id: 'shell', label: 'Shell / Bash' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'perl', label: 'Perl' },
  { id: 'lua', label: 'Lua' },
  { id: 'toml', label: 'TOML' },
  { id: 'ini', label: 'INI / Properties' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'nginx', label: 'Nginx config' },
]

const EXT_MAP: Record<string, LanguageId> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', mts: 'typescript', tsx: 'tsx',
  py: 'python', pyw: 'python',
  json: 'json', json5: 'json', jsonc: 'json',
  html: 'html', htm: 'html',
  css: 'css', scss: 'css', less: 'css',
  md: 'markdown', markdown: 'markdown',
  sql: 'sql',
  yml: 'yaml', yaml: 'yaml',
  xml: 'xml', svg: 'xml', xhtml: 'xml', plist: 'xml',
  go: 'go',
  rs: 'rust',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  java: 'java',
  php: 'php',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  rb: 'ruby',
  pl: 'perl', pm: 'perl',
  lua: 'lua',
  toml: 'toml',
  ini: 'ini', cfg: 'ini', conf: 'ini',
}

// detectLanguage picks a language by filename, with a few whole-filename
// special cases (Dockerfile, nginx.conf) that have no useful extension.
export function detectLanguage(filename: string): LanguageId {
  const base = (filename.split('/').pop() || filename).toLowerCase()
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile'
  if (base === 'nginx.conf' || base.endsWith('.nginx.conf')) return 'nginx'
  const dot = base.lastIndexOf('.')
  const ext = dot >= 0 ? base.slice(dot + 1) : ''
  return EXT_MAP[ext] ?? 'plain'
}

// loadLanguageExtension dynamically imports only the matching language
// package so the main bundle stays small.
export async function loadLanguageExtension(id: LanguageId): Promise<Extension[]> {
  switch (id) {
    case 'plain':
      return []
    case 'javascript': {
      const m = await import('@codemirror/lang-javascript')
      return [m.javascript()]
    }
    case 'jsx': {
      const m = await import('@codemirror/lang-javascript')
      return [m.javascript({ jsx: true })]
    }
    case 'typescript': {
      const m = await import('@codemirror/lang-javascript')
      return [m.javascript({ typescript: true })]
    }
    case 'tsx': {
      const m = await import('@codemirror/lang-javascript')
      return [m.javascript({ jsx: true, typescript: true })]
    }
    case 'python': {
      const m = await import('@codemirror/lang-python')
      return [m.python()]
    }
    case 'json': {
      const m = await import('@codemirror/lang-json')
      return [m.json()]
    }
    case 'html': {
      const m = await import('@codemirror/lang-html')
      return [m.html()]
    }
    case 'css': {
      const m = await import('@codemirror/lang-css')
      return [m.css()]
    }
    case 'markdown': {
      const m = await import('@codemirror/lang-markdown')
      return [m.markdown()]
    }
    case 'sql': {
      const m = await import('@codemirror/lang-sql')
      return [m.sql()]
    }
    case 'rust': {
      const m = await import('@codemirror/lang-rust')
      return [m.rust()]
    }
    case 'cpp':
    case 'c': {
      const m = await import('@codemirror/lang-cpp')
      return [m.cpp()]
    }
    case 'java': {
      const m = await import('@codemirror/lang-java')
      return [m.java()]
    }
    case 'php': {
      const m = await import('@codemirror/lang-php')
      return [m.php()]
    }
    case 'xml': {
      const m = await import('@codemirror/lang-xml')
      return [m.xml()]
    }
    case 'yaml': {
      const m = await import('@codemirror/lang-yaml')
      return [m.yaml()]
    }
    case 'go': {
      const [{ StreamLanguage }, { go }] = await Promise.all([
        import('@codemirror/language'), import('@codemirror/legacy-modes/mode/go'),
      ])
      return [StreamLanguage.define(go)]
    }
    case 'shell': {
      const [{ StreamLanguage }, { shell }] = await Promise.all([
        import('@codemirror/language'), import('@codemirror/legacy-modes/mode/shell'),
      ])
      return [StreamLanguage.define(shell)]
    }
    case 'ruby': {
      const [{ StreamLanguage }, { ruby }] = await Promise.all([
        import('@codemirror/language'), import('@codemirror/legacy-modes/mode/ruby'),
      ])
      return [StreamLanguage.define(ruby)]
    }
    case 'perl': {
      const [{ StreamLanguage }, { perl }] = await Promise.all([
        import('@codemirror/language'), import('@codemirror/legacy-modes/mode/perl'),
      ])
      return [StreamLanguage.define(perl)]
    }
    case 'lua': {
      const [{ StreamLanguage }, { lua }] = await Promise.all([
        import('@codemirror/language'), import('@codemirror/legacy-modes/mode/lua'),
      ])
      return [StreamLanguage.define(lua)]
    }
    case 'toml': {
      const [{ StreamLanguage }, { toml }] = await Promise.all([
        import('@codemirror/language'), import('@codemirror/legacy-modes/mode/toml'),
      ])
      return [StreamLanguage.define(toml)]
    }
    case 'ini': {
      const [{ StreamLanguage }, { properties }] = await Promise.all([
        import('@codemirror/language'), import('@codemirror/legacy-modes/mode/properties'),
      ])
      return [StreamLanguage.define(properties)]
    }
    case 'dockerfile': {
      const [{ StreamLanguage }, { dockerFile }] = await Promise.all([
        import('@codemirror/language'), import('@codemirror/legacy-modes/mode/dockerfile'),
      ])
      return [StreamLanguage.define(dockerFile)]
    }
    case 'nginx': {
      const [{ StreamLanguage }, { nginx }] = await Promise.all([
        import('@codemirror/language'), import('@codemirror/legacy-modes/mode/nginx'),
      ])
      return [StreamLanguage.define(nginx)]
    }
    default:
      return []
  }
}
