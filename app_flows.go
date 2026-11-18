package main

import (
	"context"
	"errors"

	"shellbay/internal/vault"
)

// SaveFlow creates or updates an automation flow.
func (a *App) SaveFlow(f vault.Flow) (vault.Flow, error) {
	if f.Name == "" {
		f.Name = "Untitled flow"
	}
	if f.Tags == nil {
		f.Tags = []string{}
	}
	if f.Steps == nil {
		f.Steps = []vault.FlowStep{}
	}
	for i := range f.Steps {
		if f.Steps[i].ID == "" {
			f.Steps[i].ID = vault.NewID()
		}
	}
	err := a.v.Update(func(d *vault.Data) error {
		if f.ID != "" {
			for i := range d.Flows {
				if d.Flows[i].ID == f.ID {
					d.Flows[i] = f
					return nil
				}
			}
		}
		if f.ID == "" {
			f.ID = vault.NewID()
		}
		d.Flows = append(d.Flows, f)
		return nil
	})
	return f, err
}

// DeleteFlow removes a flow.
func (a *App) DeleteFlow(id string) error {
	return a.v.Update(func(d *vault.Data) error {
		out := d.Flows[:0]
		for _, f := range d.Flows {
			if f.ID != id {
				out = append(out, f)
			}
		}
		d.Flows = out
		return nil
	})
}

// FlowRun starts a flow against a host and returns a run ID. Progress streams
// via "flow:output" ({runId, line}) events, ending with "flow:done"
// ({runId, error}).
func (a *App) FlowRun(flowID, hostID string) (string, error) {
	var f vault.Flow
	found := false
	_ = a.v.View(func(d *vault.Data) {
		for _, x := range d.Flows {
			if x.ID == flowID {
				f, found = x, true
			}
		}
	})
	if !found {
		return "", errors.New("flow not found")
	}
	if hostID == "" {
		return "", errors.New("choose a host to run this flow on")
	}

	runID := vault.NewID()
	ctx, cancel := context.WithCancel(context.Background())
	a.mu.Lock()
	a.flowRuns[runID] = cancel
	a.mu.Unlock()

	go func() {
		defer func() {
			a.mu.Lock()
			delete(a.flowRuns, runID)
			a.mu.Unlock()
		}()
		err := a.flows.Run(ctx, hostID, f.Steps, &uiPrompter{a}, func(line string) {
			a.emit("flow:output", map[string]any{"runId": runID, "line": line})
		})
		msg := ""
		if err != nil {
			msg = err.Error()
		}
		a.emit("flow:done", map[string]any{"runId": runID, "error": msg})
	}()
	return runID, nil
}

// FlowStop cancels a running flow.
func (a *App) FlowStop(runID string) {
	a.mu.Lock()
	cancel := a.flowRuns[runID]
	a.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}
