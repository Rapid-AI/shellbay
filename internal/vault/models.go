package vault

// Group is a flat folder for hosts.
type Group struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Host is a saved SSH destination.
type Host struct {
	ID             string   `json:"id"`
	Label          string   `json:"label"`
	Address        string   `json:"address"`
	Port           int      `json:"port"`
	Username       string   `json:"username"`
	AuthType       string   `json:"authType"` // password | key | agent
	Password       string   `json:"password"`
	KeyID          string   `json:"keyId"`
	GroupID        string   `json:"groupId"`
	Tags           []string `json:"tags"`
	JumpHostID     string   `json:"jumpHostId"`
	StartupCommand string   `json:"startupCommand"`
	Note           string   `json:"note"`
	Color          string   `json:"color"`
	Protocol       string   `json:"protocol"` // ssh | ftp
	OS             string   `json:"os"`       // linux | darwin | windows | bsd | "" (undetected)
	Favorite       bool     `json:"favorite"`
	CreatedAt      int64    `json:"createdAt"`
	LastUsedAt     int64    `json:"lastUsedAt"`
}

// Key is an SSH private key stored in the vault.
type Key struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	PrivateKey  string `json:"privateKey"`
	PublicKey   string `json:"publicKey"`
	Passphrase  string `json:"passphrase"`
	Fingerprint string `json:"fingerprint"`
	CreatedAt   int64  `json:"createdAt"`
}

// Snippet is a reusable command.
type Snippet struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Command string   `json:"command"`
	Tags    []string `json:"tags"`
}

// FlowStep is one step of an automation Flow. Which fields are used depends
// on Kind: send | wait | pause | upload | download | condition | prompt | script.
type FlowStep struct {
	ID            string `json:"id"`
	Kind          string `json:"kind"`
	Text          string `json:"text,omitempty"`          // send
	AppendEnter   bool   `json:"appendEnter,omitempty"`   // send
	Pattern       string `json:"pattern,omitempty"`       // wait, condition (regexp)
	TimeoutMs     int    `json:"timeoutMs,omitempty"`     // wait, condition
	OnNoMatchGoto int    `json:"onNoMatchGoto,omitempty"` // condition: step index; <0 or out of range stops the run
	DurationMs    int    `json:"durationMs,omitempty"`    // pause
	LocalPath     string `json:"localPath,omitempty"`     // upload, download
	RemotePath    string `json:"remotePath,omitempty"`    // upload, download
	VarName       string `json:"varName,omitempty"`       // prompt
	Message       string `json:"message,omitempty"`       // prompt
	Secret        bool   `json:"secret,omitempty"`        // prompt
	Lang          string `json:"lang,omitempty"`          // script: lua | js
	Code          string `json:"code,omitempty"`          // script
}

// Flow is a saved automation scenario: an ordered list of steps run against
// a host chosen at run time.
type Flow struct {
	ID    string     `json:"id"`
	Name  string     `json:"name"`
	Tags  []string   `json:"tags"`
	Steps []FlowStep `json:"steps"`
}

// CommandStat tracks how often a shell command (and optionally one of its
// flags) has been run, to personalize the terminal's suggestion popup.
// Flag is empty for the "bare command" row.
type CommandStat struct {
	Command    string `json:"command"`
	Flag       string `json:"flag"`
	Count      int    `json:"count"`
	LastUsedAt int64  `json:"lastUsedAt"`
}

// Forward is a port forwarding rule.
type Forward struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"` // local | remote | dynamic
	HostID   string `json:"hostId"`
	BindAddr string `json:"bindAddr"`
	BindPort int    `json:"bindPort"`
	DestAddr string `json:"destAddr"`
	DestPort int    `json:"destPort"`
}

// KnownHost is a trusted server host key.
type KnownHost struct {
	Host        string `json:"host"`
	KeyType     string `json:"keyType"`
	Fingerprint string `json:"fingerprint"`
	PublicKey   string `json:"publicKey"`
	AddedAt     int64  `json:"addedAt"`
}

// Peer is a paired teammate device.
type Peer struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Address     string `json:"address"`
	Fingerprint string `json:"fingerprint"`
	AddedAt     int64  `json:"addedAt"`
	LastSeenAt  int64  `json:"lastSeenAt"`
}

// Identity is this device's P2P identity (self-signed certificate).
type Identity struct {
	DeviceName string `json:"deviceName"`
	CertPEM    string `json:"certPem"`
	KeyPEM     string `json:"keyPem"`
}

// Settings are user preferences.
type Settings struct {
	Theme         string `json:"theme"`
	FontSize      int    `json:"fontSize"`
	FontFamily    string `json:"fontFamily"`
	Scrollback    int    `json:"scrollback"`
	CursorStyle   string `json:"cursorStyle"`
	LogSessions   bool   `json:"logSessions"`
	LogFormat     string `json:"logFormat"` // raw | plain
	LogTimestamps bool   `json:"logTimestamps"`
	KeepAliveSec  int    `json:"keepAliveSec"`
	ShareEnabled  bool   `json:"shareEnabled"`
	SharePort     int    `json:"sharePort"`
	Language      string `json:"language"`  // ru | en | es | zh | ja | de
	UiTheme       string `json:"uiTheme"`   // light | dark | system (which built-in scheme "system" resolves to)
	UiThemeId     string `json:"uiThemeId"` // theme engine: a family id ("classic", "simple" — follow UiTheme within that family) or a pinned theme id
	// DisabledPluginIDs lists installed plugins the user has turned off.
	// Absence from this list (including a plugin that was just installed)
	// means enabled — there's no separate "enabled" list to keep in sync.
	DisabledPluginIDs []string `json:"disabledPluginIds"`
}

// DefaultSettings returns the initial preferences.
func DefaultSettings() Settings {
	return Settings{
		Theme:         "midnight",
		FontSize:      13,
		FontFamily:    `"SF Mono", Menlo, Monaco, monospace`,
		Scrollback:    10000,
		CursorStyle:   "block",
		LogFormat:     "plain",
		LogTimestamps: true,
		KeepAliveSec:  30,
		SharePort:     7878,
		UiTheme:       "dark",
		UiThemeId:     "classic",
		Language:      "en",
	}
}

// Data is the whole decrypted vault content.
type Data struct {
	Version      int           `json:"version"`
	Groups       []Group       `json:"groups"`
	Hosts        []Host        `json:"hosts"`
	Keys         []Key         `json:"keys"`
	Snippets     []Snippet     `json:"snippets"`
	Flows        []Flow        `json:"flows"`
	CommandStats []CommandStat `json:"commandStats"`
	Forwards     []Forward     `json:"forwards"`
	KnownHosts   []KnownHost   `json:"knownHosts"`
	Peers        []Peer        `json:"peers"`
	Identity     Identity      `json:"identity"`
	Settings     Settings      `json:"settings"`
}

// Normalize makes sure nothing is nil and settings have sane values.
func (d *Data) Normalize() {
	d.Version = 1
	if d.Groups == nil {
		d.Groups = []Group{}
	}
	if d.Hosts == nil {
		d.Hosts = []Host{}
	}
	if d.Keys == nil {
		d.Keys = []Key{}
	}
	if d.Snippets == nil {
		d.Snippets = []Snippet{}
	}
	if d.Flows == nil {
		d.Flows = []Flow{}
	}
	if d.CommandStats == nil {
		d.CommandStats = []CommandStat{}
	}
	if d.Forwards == nil {
		d.Forwards = []Forward{}
	}
	if d.KnownHosts == nil {
		d.KnownHosts = []KnownHost{}
	}
	if d.Peers == nil {
		d.Peers = []Peer{}
	}
	for i := range d.Hosts {
		if d.Hosts[i].Tags == nil {
			d.Hosts[i].Tags = []string{}
		}
		if d.Hosts[i].Protocol == "" {
			d.Hosts[i].Protocol = "ssh"
		}
	}
	for i := range d.Snippets {
		if d.Snippets[i].Tags == nil {
			d.Snippets[i].Tags = []string{}
		}
	}
	for i := range d.Flows {
		if d.Flows[i].Tags == nil {
			d.Flows[i].Tags = []string{}
		}
		if d.Flows[i].Steps == nil {
			d.Flows[i].Steps = []FlowStep{}
		}
	}
	def := DefaultSettings()
	s := &d.Settings
	if s.Theme == "" {
		s.Theme = def.Theme
	}
	if s.FontSize == 0 {
		s.FontSize = def.FontSize
	}
	if s.FontFamily == "" {
		s.FontFamily = def.FontFamily
	}
	if s.Scrollback == 0 {
		s.Scrollback = def.Scrollback
	}
	if s.CursorStyle == "" {
		s.CursorStyle = def.CursorStyle
	}
	if s.LogFormat == "" {
		// LogFormat was introduced alongside LogTimestamps; an empty LogFormat
		// means this vault predates both, so default the timestamp flag too.
		s.LogFormat = def.LogFormat
		s.LogTimestamps = def.LogTimestamps
	}
	if s.KeepAliveSec == 0 {
		s.KeepAliveSec = def.KeepAliveSec
	}
	if s.SharePort == 0 {
		s.SharePort = def.SharePort
	}
	if s.Language == "" {
		s.Language = def.Language
	}
	if s.UiTheme == "" {
		s.UiTheme = def.UiTheme
	}
	if s.UiThemeId == "" {
		s.UiThemeId = def.UiThemeId
	}
	if s.DisabledPluginIDs == nil {
		s.DisabledPluginIDs = []string{}
	}
}
