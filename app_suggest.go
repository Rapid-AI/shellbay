package main

import (
	"regexp"
	"sync"
	"time"

	"shellbay/internal/vault"
)

// commandNamePattern guards what we'll ever send as "<token> --help" to a
// host: plain-looking executable names only, never arbitrary shell input.
var commandNamePattern = regexp.MustCompile(`^[a-zA-Z0-9_./-]{1,40}$`)

// noHelpBuiltins are shell builtins (or otherwise pointless) for which
// running "<name> --help" as a one-shot remote command doesn't make sense.
var noHelpBuiltins = map[string]bool{
	"cd": true, "exit": true, "logout": true, "export": true, "source": true,
	"alias": true, "unalias": true, "unset": true, "trap": true, "set": true,
	"eval": true, "exec": true, "read": true, "shift": true, "wait": true,
	"true": true, "false": true, "pwd": true, "echo": true, "history": true,
}

type suggestCache struct {
	mu    sync.Mutex
	byKey map[string]string // "hostID\x00command" -> raw --help output ("" = fetched, nothing useful)
}

func newSuggestCache() *suggestCache { return &suggestCache{byKey: map[string]string{}} }

// CommandHelp returns the cached (or freshly fetched) "<command> --help"
// output from the given host, for the terminal's suggestion popup. Returns
// "" without error for builtins/invalid names/empty output — the frontend
// just falls back to its static dictionary in that case.
func (a *App) CommandHelp(hostID, command string) (string, error) {
	if !commandNamePattern.MatchString(command) || noHelpBuiltins[command] {
		return "", nil
	}
	key := hostID + "\x00" + command
	a.suggestCache.mu.Lock()
	if out, ok := a.suggestCache.byKey[key]; ok {
		a.suggestCache.mu.Unlock()
		return out, nil
	}
	a.suggestCache.mu.Unlock()

	out, _ := a.ssh.Exec(hostID, command+" --help 2>&1")
	if len(out) > 20000 {
		out = out[:20000]
	}
	a.suggestCache.mu.Lock()
	a.suggestCache.byKey[key] = out
	a.suggestCache.mu.Unlock()
	return out, nil
}

// TrackCommandUsage records that the user ran a command (and, if any, which
// of its flags), to personalize future suggestion ranking. flags may be
// empty (bare command, no recognized flags).
func (a *App) TrackCommandUsage(command string, flags []string) error {
	if command == "" {
		return nil
	}
	now := time.Now().UnixMilli()
	rows := flags
	if len(rows) == 0 {
		rows = []string{""}
	}
	return a.v.Update(func(d *vault.Data) error {
		for _, flag := range rows {
			found := false
			for i := range d.CommandStats {
				s := &d.CommandStats[i]
				if s.Command == command && s.Flag == flag {
					s.Count++
					s.LastUsedAt = now
					found = true
					break
				}
			}
			if !found {
				d.CommandStats = append(d.CommandStats, vault.CommandStat{
					Command: command, Flag: flag, Count: 1, LastUsedAt: now,
				})
			}
		}
		return nil
	})
}
