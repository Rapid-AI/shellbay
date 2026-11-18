// Package flow runs saved automation scenarios (vault.Flow) step by step
// against a host: send text, wait for an output pattern, pause, transfer a
// file over SFTP, branch on a pattern, ask the user for a variable, or run a
// small JS/Lua script against the same live session.
package flow

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/dop251/goja"
	lua "github.com/yuin/gopher-lua"

	"shellbay/internal/fm"
	"shellbay/internal/sshx"
	"shellbay/internal/vault"
)

// Runner executes Flow steps. One Runner can be reused across concurrent
// runs; all per-run state is local to Run.
type Runner struct {
	SSH *sshx.Manager
}

// Run executes steps against hostID, reporting a short human-readable line
// for each step (and any pattern it matched) via onOutput. prompt answers
// "prompt" steps; pass nil if the flow has none.
func (r *Runner) Run(ctx context.Context, hostID string, steps []vault.FlowStep, prompt sshx.Prompter, onOutput func(string)) error {
	if len(steps) == 0 {
		return nil
	}
	sh, err := r.SSH.OpenShell(hostID)
	if err != nil {
		return err
	}
	defer sh.Close()

	vars := map[string]string{}
	sub := func(s string) string {
		for k, v := range vars {
			s = strings.ReplaceAll(s, "{{"+k+"}}", v)
		}
		return s
	}

	i := 0
	for i < len(steps) {
		if err := ctx.Err(); err != nil {
			return err
		}
		st := steps[i]
		onOutput("▸ " + stepLabel(st))
		switch st.Kind {
		case "send":
			text := sub(st.Text)
			if st.AppendEnter {
				text += "\r"
			}
			if err := sh.Write([]byte(text)); err != nil {
				return err
			}

		case "wait":
			match, err := sh.WaitFor(ctx, sub(st.Pattern), time.Duration(st.TimeoutMs)*time.Millisecond)
			if err != nil {
				return err
			}
			onOutput(match)

		case "condition":
			match, err := sh.WaitFor(ctx, sub(st.Pattern), time.Duration(st.TimeoutMs)*time.Millisecond)
			if err == nil {
				onOutput(match)
				break
			}
			next := st.OnNoMatchGoto
			if next < 0 || next >= len(steps) {
				return nil
			}
			i = next
			continue

		case "pause":
			select {
			case <-time.After(time.Duration(st.DurationMs) * time.Millisecond):
			case <-ctx.Done():
				return ctx.Err()
			}

		case "upload", "download":
			if err := r.transfer(hostID, st, sub); err != nil {
				return err
			}

		case "prompt":
			if prompt == nil {
				return errors.New("this flow needs user input, but no prompt handler is available")
			}
			v, err := prompt.Ask(sshx.PromptRequest{Kind: "text", Title: "Automation", Message: sub(st.Message), Secret: st.Secret})
			if err != nil {
				return err
			}
			vars[st.VarName] = v

		case "script":
			if err := r.runScript(ctx, sh, st, vars, onOutput); err != nil {
				return err
			}

		default:
			return fmt.Errorf("unknown step kind %q", st.Kind)
		}
		i++
	}
	return nil
}

func (r *Runner) transfer(hostID string, st vault.FlowStep, sub func(string) string) error {
	lease, err := r.SSH.Acquire(hostID)
	if err != nil {
		return err
	}
	sftpFS, err := fm.NewSFTP("flow-"+vault.NewID(), lease)
	if err != nil {
		lease.Release()
		return err
	}
	defer sftpFS.Close()

	local, remote := sub(st.LocalPath), sub(st.RemotePath)
	if st.Kind == "upload" {
		in, err := os.Open(local)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := sftpFS.Create(remote)
		if err != nil {
			return err
		}
		defer out.Close()
		_, err = io.Copy(out, in)
		return err
	}
	in, err := sftpFS.Open(remote)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(local)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func (r *Runner) runScript(ctx context.Context, sh *sshx.Shell, st vault.FlowStep, vars map[string]string, onOutput func(string)) error {
	switch st.Lang {
	case "lua":
		return runLua(ctx, sh, st.Code, vars, onOutput)
	default:
		return runJS(ctx, sh, st.Code, vars, onOutput)
	}
}

func runJS(ctx context.Context, sh *sshx.Shell, code string, vars map[string]string, onOutput func(string)) error {
	vm := goja.New()
	api := vm.NewObject()
	_ = api.Set("send", func(text string) error { return sh.Write([]byte(text)) })
	_ = api.Set("expect", func(pattern string, timeoutMs int) (string, error) {
		return sh.WaitFor(ctx, pattern, time.Duration(timeoutMs)*time.Millisecond)
	})
	_ = api.Set("sleep", func(ms int) { time.Sleep(time.Duration(ms) * time.Millisecond) })
	_ = api.Set("log", func(s string) { onOutput(s) })
	_ = api.Set("getVar", func(name string) string { return vars[name] })
	_ = api.Set("setVar", func(name, val string) { vars[name] = val })
	_ = vm.Set("shellbay", api)
	_ = vm.Set("harbor", api) // Compatibility for scripts already saved in a vault.
	_, err := vm.RunString(code)
	return err
}

func runLua(ctx context.Context, sh *sshx.Shell, code string, vars map[string]string, onOutput func(string)) error {
	L := lua.NewState()
	defer L.Close()
	tbl := L.NewTable()
	L.SetField(tbl, "send", L.NewFunction(func(L *lua.LState) int {
		if err := sh.Write([]byte(L.ToString(1))); err != nil {
			L.RaiseError("%s", err.Error())
		}
		return 0
	}))
	L.SetField(tbl, "expect", L.NewFunction(func(L *lua.LState) int {
		match, err := sh.WaitFor(ctx, L.ToString(1), time.Duration(L.OptInt(2, 30000))*time.Millisecond)
		if err != nil {
			L.RaiseError("%s", err.Error())
			return 0
		}
		L.Push(lua.LString(match))
		return 1
	}))
	L.SetField(tbl, "sleep", L.NewFunction(func(L *lua.LState) int {
		time.Sleep(time.Duration(L.ToInt(1)) * time.Millisecond)
		return 0
	}))
	L.SetField(tbl, "log", L.NewFunction(func(L *lua.LState) int {
		onOutput(L.ToString(1))
		return 0
	}))
	L.SetField(tbl, "getVar", L.NewFunction(func(L *lua.LState) int {
		L.Push(lua.LString(vars[L.ToString(1)]))
		return 1
	}))
	L.SetField(tbl, "setVar", L.NewFunction(func(L *lua.LState) int {
		vars[L.ToString(1)] = L.ToString(2)
		return 0
	}))
	L.SetGlobal("shellbay", tbl)
	L.SetGlobal("harbor", tbl) // Same compatibility alias as the JavaScript runner.
	return L.DoString(code)
}

func stepLabel(st vault.FlowStep) string {
	switch st.Kind {
	case "send":
		return "Send: " + st.Text
	case "wait":
		return "Wait for: " + st.Pattern
	case "pause":
		return fmt.Sprintf("Pause %dms", st.DurationMs)
	case "upload":
		return "Upload " + st.LocalPath + " -> " + st.RemotePath
	case "download":
		return "Download " + st.RemotePath + " -> " + st.LocalPath
	case "condition":
		return "Condition: " + st.Pattern
	case "prompt":
		return "Prompt: " + st.Message
	case "script":
		return "Script (" + st.Lang + ")"
	default:
		return st.Kind
	}
}
