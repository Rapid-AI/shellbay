package main

import (
	"embed"
	"log"
	goruntime "runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

// The production app serves the built React interface from the executable.
// Build the frontend before invoking Go directly.
//
//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	appMenu := menu.NewMenu()
	if goruntime.GOOS == "darwin" {
		appMenu.Append(menu.AppMenu())
		appMenu.Append(menu.EditMenu())
		appMenu.Append(menu.WindowMenu())
	}

	err := wails.Run(&options.App{
		Title:            appName,
		Width:            1360,
		Height:           860,
		MinWidth:         980,
		MinHeight:        600,
		BackgroundColour: &options.RGBA{R: 13, G: 18, B: 32, A: 255},
		AssetServer:      &assetserver.Options{Assets: assets},
		Menu:             appMenu,
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind:             []interface{}{app},
		Mac: &mac.Options{
			TitleBar:   mac.TitleBarHiddenInset(),
			Appearance: mac.NSAppearanceNameDarkAqua,
			About: &mac.AboutInfo{
				Title:   appName,
				Message: "SSH client with a two-pane SFTP file manager and serverless team sharing.\nVersion " + appVersion,
			},
		},
		// Windows/Linux use the OS's normal window frame (no traffic-light
		// inset to emulate), just forced to dark since the UI has no light
		// chrome to fall back to outside the in-app theme toggle.
		Windows: &windows.Options{
			Theme: windows.Dark,
		},
		Linux: &linux.Options{
			ProgramName: appName,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
