export interface FlagSuggestion { flag: string; desc: string; count: number; rank: number }

// A small bundled reference for common commands so suggestions show up
// instantly, before (or even without) a live "--help" fetch from the host.
export const BASE_COMMANDS: Record<string, { flag: string; desc: string }[]> = {
  ssh: [
    { flag: '-p', desc: 'Port to connect to' }, { flag: '-i', desc: 'Identity (private key) file' },
    { flag: '-v', desc: 'Verbose mode' }, { flag: '-L', desc: 'Local port forward' },
    { flag: '-R', desc: 'Remote port forward' }, { flag: '-D', desc: 'Dynamic (SOCKS) forward' },
    { flag: '-N', desc: 'No remote command' }, { flag: '-A', desc: 'Forward ssh-agent' },
  ],
  scp: [
    { flag: '-r', desc: 'Recursive copy' }, { flag: '-P', desc: 'Port to connect to' },
    { flag: '-i', desc: 'Identity (private key) file' }, { flag: '-p', desc: 'Preserve file attributes' },
  ],
  rsync: [
    { flag: '-a', desc: 'Archive mode' }, { flag: '-v', desc: 'Verbose' }, { flag: '-z', desc: 'Compress' },
    { flag: '-n', desc: 'Dry run' }, { flag: '--delete', desc: 'Delete extraneous destination files' },
    { flag: '-e', desc: 'Remote shell to use' }, { flag: '-P', desc: 'Show progress, keep partial files' },
  ],
  ftp: [
    { flag: '-n', desc: 'No auto-login' }, { flag: '-i', desc: 'Turn off interactive prompting' },
    { flag: '-v', desc: 'Verbose' }, { flag: '-p', desc: 'Passive mode' },
  ],
  curl: [
    { flag: '-X', desc: 'Request method' }, { flag: '-H', desc: 'Header' }, { flag: '-d', desc: 'POST data' },
    { flag: '-o', desc: 'Write output to file' }, { flag: '-L', desc: 'Follow redirects' },
    { flag: '-s', desc: 'Silent mode' }, { flag: '-I', desc: 'Fetch headers only' }, { flag: '-k', desc: 'Allow insecure TLS' },
  ],
  wget: [
    { flag: '-O', desc: 'Write output to file' }, { flag: '-q', desc: 'Quiet' }, { flag: '-c', desc: 'Resume download' },
    { flag: '-r', desc: 'Recursive' }, { flag: '--limit-rate', desc: 'Limit download rate' },
  ],
  git: [
    { flag: 'status', desc: '' }, { flag: 'log', desc: '' }, { flag: 'diff', desc: '' }, { flag: 'pull', desc: '' },
    { flag: 'push', desc: '' }, { flag: 'checkout', desc: '' }, { flag: '-a', desc: 'All (commit/branch)' },
    { flag: '-m', desc: 'Commit message' }, { flag: '--force', desc: 'Force' },
  ],
  docker: [
    { flag: 'ps', desc: '' }, { flag: 'logs', desc: '' }, { flag: 'exec', desc: '' }, { flag: 'build', desc: '' },
    { flag: '-it', desc: 'Interactive + TTY' }, { flag: '-d', desc: 'Detached' }, { flag: '-p', desc: 'Publish port' },
    { flag: '-v', desc: 'Mount volume' }, { flag: '--rm', desc: 'Remove on exit' },
  ],
  systemctl: [
    { flag: 'status', desc: '' }, { flag: 'start', desc: '' }, { flag: 'stop', desc: '' }, { flag: 'restart', desc: '' },
    { flag: 'enable', desc: '' }, { flag: 'disable', desc: '' }, { flag: '--now', desc: 'Apply immediately' },
  ],
  journalctl: [
    { flag: '-u', desc: 'Unit' }, { flag: '-f', desc: 'Follow' }, { flag: '-n', desc: 'Show last N lines' },
    { flag: '--since', desc: 'Since time' }, { flag: '-xe', desc: 'Jump to end with explanations' },
  ],
  grep: [
    { flag: '-r', desc: 'Recursive' }, { flag: '-i', desc: 'Case-insensitive' }, { flag: '-n', desc: 'Show line numbers' },
    { flag: '-v', desc: 'Invert match' }, { flag: '-E', desc: 'Extended regex' }, { flag: '-l', desc: 'Only filenames' },
  ],
  find: [
    { flag: '-name', desc: 'Match filename' }, { flag: '-type', desc: 'f (file) or d (dir)' },
    { flag: '-mtime', desc: 'Modified N days ago' }, { flag: '-exec', desc: 'Run a command on matches' },
    { flag: '-size', desc: 'Match size' },
  ],
  tar: [
    { flag: '-x', desc: 'Extract' }, { flag: '-c', desc: 'Create' }, { flag: '-v', desc: 'Verbose' },
    { flag: '-z', desc: 'gzip' }, { flag: '-f', desc: 'Archive file' }, { flag: '-t', desc: 'List contents' },
  ],
  chmod: [{ flag: '-R', desc: 'Recursive' }],
  chown: [{ flag: '-R', desc: 'Recursive' }],
  ps: [{ flag: '-ef', desc: 'Full listing, all processes' }, { flag: 'aux', desc: 'BSD-style full listing' }],
  kill: [{ flag: '-9', desc: 'SIGKILL' }, { flag: '-15', desc: 'SIGTERM' }, { flag: '-l', desc: 'List signal names' }],
  netstat: [{ flag: '-tulpn', desc: 'Listening TCP/UDP with PIDs' }, { flag: '-r', desc: 'Routing table' }],
  ss: [{ flag: '-tulpn', desc: 'Listening TCP/UDP with PIDs' }],
  top: [{ flag: '-u', desc: 'Filter by user' }],
  df: [{ flag: '-h', desc: 'Human-readable sizes' }],
  du: [{ flag: '-sh', desc: 'Summarized, human-readable' }],
  ls: [{ flag: '-la', desc: 'All files, long format' }, { flag: '-h', desc: 'Human-readable sizes' }],
  ping: [{ flag: '-c', desc: 'Packet count' }],
  apt: [{ flag: 'update', desc: '' }, { flag: 'install', desc: '' }, { flag: 'upgrade', desc: '' }, { flag: 'remove', desc: '' }],
  yum: [{ flag: 'install', desc: '' }, { flag: 'update', desc: '' }, { flag: 'remove', desc: '' }],
  dnf: [{ flag: 'install', desc: '' }, { flag: 'update', desc: '' }, { flag: 'remove', desc: '' }],
  npm: [{ flag: 'install', desc: '' }, { flag: 'run', desc: '' }, { flag: 'ci', desc: '' }, { flag: '-g', desc: 'Global' }],
  kubectl: [
    { flag: 'get', desc: '' }, { flag: 'describe', desc: '' }, { flag: 'logs', desc: '' }, { flag: 'apply', desc: '' },
    { flag: '-n', desc: 'Namespace' }, { flag: '-f', desc: 'File' }, { flag: '-o', desc: 'Output format' },
  ],
  nginx: [
    { flag: '-t', desc: 'Test config syntax' }, { flag: '-s', desc: 'Send signal (reload/stop/quit)' },
    { flag: '-v', desc: 'Version' }, { flag: '-V', desc: 'Version + build/config options' },
    { flag: '-g', desc: 'Set a global directive' }, { flag: '-c', desc: 'Config file path' },
  ],
  apache2: [
    { flag: '-t', desc: 'Test config syntax' }, { flag: '-k', desc: 'start/stop/restart/graceful' },
    { flag: '-v', desc: 'Version' }, { flag: '-M', desc: 'List loaded modules' }, { flag: '-S', desc: 'Show vhosts' },
  ],
  httpd: [
    { flag: '-t', desc: 'Test config syntax' }, { flag: '-k', desc: 'start/stop/restart/graceful' },
    { flag: '-v', desc: 'Version' }, { flag: '-M', desc: 'List loaded modules' },
  ],
  mysql: [
    { flag: '-u', desc: 'User' }, { flag: '-p', desc: 'Prompt for password' }, { flag: '-h', desc: 'Host' },
    { flag: '-e', desc: 'Execute statement and exit' }, { flag: '-D', desc: 'Database' },
  ],
  mysqld: [
    { flag: '--verbose', desc: '' }, { flag: '--version', desc: '' }, { flag: '--skip-grant-tables', desc: '' },
  ],
  psql: [
    { flag: '-U', desc: 'User' }, { flag: '-d', desc: 'Database' }, { flag: '-h', desc: 'Host' },
    { flag: '-p', desc: 'Port' }, { flag: '-c', desc: 'Run command and exit' }, { flag: '-l', desc: 'List databases' },
  ],
  'redis-cli': [
    { flag: '-h', desc: 'Host' }, { flag: '-p', desc: 'Port' }, { flag: '-a', desc: 'Password' },
    { flag: '--scan', desc: 'Scan keys' }, { flag: 'ping', desc: '' }, { flag: 'monitor', desc: '' },
  ],
  'docker-compose': [
    { flag: 'up', desc: '' }, { flag: 'down', desc: '' }, { flag: 'ps', desc: '' }, { flag: 'logs', desc: '' },
    { flag: 'restart', desc: '' }, { flag: '-d', desc: 'Detached' }, { flag: '-f', desc: 'Compose file' },
    { flag: '--build', desc: 'Rebuild images' },
  ],
  ufw: [
    { flag: 'status', desc: '' }, { flag: 'allow', desc: '' }, { flag: 'deny', desc: '' }, { flag: 'enable', desc: '' },
    { flag: 'disable', desc: '' }, { flag: 'delete', desc: '' },
  ],
  iptables: [
    { flag: '-L', desc: 'List rules' }, { flag: '-A', desc: 'Append rule' }, { flag: '-D', desc: 'Delete rule' },
    { flag: '-F', desc: 'Flush rules' }, { flag: '-n', desc: 'Numeric output' }, { flag: '-t', desc: 'Table' },
  ],
  certbot: [
    { flag: 'certonly', desc: '' }, { flag: 'renew', desc: '' }, { flag: '--nginx', desc: 'Use the nginx plugin' },
    { flag: '--apache', desc: 'Use the apache plugin' }, { flag: '-d', desc: 'Domain' }, { flag: '--dry-run', desc: '' },
  ],
  supervisorctl: [
    { flag: 'status', desc: '' }, { flag: 'restart', desc: '' }, { flag: 'stop', desc: '' }, { flag: 'start', desc: '' },
    { flag: 'reread', desc: '' }, { flag: 'update', desc: '' },
  ],
  pm2: [
    { flag: 'start', desc: '' }, { flag: 'restart', desc: '' }, { flag: 'stop', desc: '' }, { flag: 'logs', desc: '' },
    { flag: 'list', desc: '' }, { flag: 'delete', desc: '' }, { flag: '--name', desc: 'Process name' },
  ],
  'fail2ban-client': [
    { flag: 'status', desc: '' }, { flag: 'unban', desc: '' }, { flag: 'set', desc: '' }, { flag: 'reload', desc: '' },
  ],
  crontab: [{ flag: '-l', desc: 'List' }, { flag: '-e', desc: 'Edit' }, { flag: '-r', desc: 'Remove' }, { flag: '-u', desc: 'User' }],
  firewalld: [{ flag: '--state', desc: '' }, { flag: '--reload', desc: '' }],
  'firewall-cmd': [
    { flag: '--state', desc: '' }, { flag: '--list-all', desc: '' }, { flag: '--add-port', desc: '' },
    { flag: '--reload', desc: '' }, { flag: '--permanent', desc: '' },
  ],
  htop: [{ flag: '-u', desc: 'Filter by user' }],
  lsof: [{ flag: '-i', desc: 'Network sockets' }, { flag: '-p', desc: 'By PID' }, { flag: '-u', desc: 'By user' }],
  tcpdump: [
    { flag: '-i', desc: 'Interface' }, { flag: '-n', desc: 'Don\'t resolve names' }, { flag: '-w', desc: 'Write to file' },
    { flag: '-c', desc: 'Packet count' },
  ],
  mount: [{ flag: '-a', desc: 'Mount everything in fstab' }, { flag: '-t', desc: 'Filesystem type' }, { flag: '-o', desc: 'Options' }],
  umount: [{ flag: '-f', desc: 'Force' }, { flag: '-l', desc: 'Lazy unmount' }],
  free: [{ flag: '-h', desc: 'Human-readable sizes' }, { flag: '-m', desc: 'In MB' }],
  uptime: [{ flag: '-p', desc: 'Pretty format' }],
  useradd: [{ flag: '-m', desc: 'Create home directory' }, { flag: '-s', desc: 'Login shell' }, { flag: '-G', desc: 'Groups' }],
  usermod: [{ flag: '-aG', desc: 'Append to groups' }, { flag: '-s', desc: 'Login shell' }, { flag: '-L', desc: 'Lock account' }],
  passwd: [{ flag: '-l', desc: 'Lock' }, { flag: '-u', desc: 'Unlock' }, { flag: '-e', desc: 'Expire password' }],
  timedatectl: [{ flag: 'set-timezone', desc: '' }, { flag: 'status', desc: '' }, { flag: 'set-ntp', desc: '' }],
  hostnamectl: [{ flag: 'set-hostname', desc: '' }, { flag: 'status', desc: '' }],
  openssl: [
    { flag: 'req', desc: '' }, { flag: 'x509', desc: '' }, { flag: 's_client', desc: '' }, { flag: 'genrsa', desc: '' },
    { flag: '-in', desc: 'Input file' }, { flag: '-out', desc: 'Output file' },
  ],
}

const FLAG_LINE = /^[ \t]{0,4}(-{1,2}[\w][\w-]*)(?:[, ]+(-{1,2}[\w][\w-]*))?(?:[=, ][A-Z][\w]*)?\s{2,}(.+)$/

// Parses "--help"-style output into flag/description pairs. Best-effort:
// matches the common "  -x, --long   Description" shape; anything stranger
// is simply skipped (callers fall back to the base dictionary).
export function parseHelpOutput(text: string): { flag: string; desc: string }[] {
  const out: { flag: string; desc: string }[] = []
  for (const raw of text.split('\n')) {
    const m = FLAG_LINE.exec(raw.replace(/\t/g, '    '))
    if (!m) continue
    const desc = m[3].trim().slice(0, 80)
    out.push({ flag: m[1], desc })
    if (m[2]) out.push({ flag: m[2], desc })
    if (out.length >= 40) break
  }
  return out
}

// LIVE_RANK is the fallback rank for a flag discovered only via a live
// "--help" fetch (not in the bundled dictionary) — dictionary order is used
// as a stand-in for "how common is this in server setup guides", so a known
// common flag still outranks a freshly-discovered obscure one until you've
// actually used it yourself.
const LIVE_RANK = 1000

export function mergeSuggestions(
  base: { flag: string; desc: string }[],
  live: { flag: string; desc: string }[],
  stats: Record<string, number>,
  filter: string,
): FlagSuggestion[] {
  const byFlag = new Map<string, FlagSuggestion>()
  base.forEach((b, i) => byFlag.set(b.flag, { flag: b.flag, desc: b.desc, count: stats[b.flag] ?? 0, rank: i }))
  for (const l of live) {
    const prev = byFlag.get(l.flag)
    byFlag.set(l.flag, {
      flag: l.flag, desc: l.desc || prev?.desc || '', count: stats[l.flag] ?? prev?.count ?? 0,
      rank: prev?.rank ?? LIVE_RANK,
    })
  }
  let list = Array.from(byFlag.values())
  if (filter) list = list.filter((s) => s.flag.startsWith(filter))
  list.sort((a, b) => b.count - a.count || a.rank - b.rank || a.flag.localeCompare(b.flag))
  return list.slice(0, 20)
}
