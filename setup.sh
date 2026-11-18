#!/usr/bin/env bash
# Build on macOS or Linux, or launch the Wails development window.
set -euo pipefail
cd "$(dirname "$0")"

mode="${1:-build}"
target="${2:-}"
case "$mode" in
  build|dev) ;;
  *) echo "Usage: ./setup.sh [build|dev] [platform]" >&2; exit 1 ;;
esac

for command in go node npm; do
  command -v "$command" >/dev/null || { echo "Install $command first. See README.md." >&2; exit 1; }
done

flags=()
case "$(uname -s)" in
  Darwin)
    # Prefer the configured SDK. Standalone tools also work when a separate
    # Xcode installation is present but has not completed first-run setup.
    if ! xcrun --find clang >/dev/null 2>&1; then
      if [ -x /Library/Developer/CommandLineTools/usr/bin/clang ]; then
        export DEVELOPER_DIR=/Library/Developer/CommandLineTools
      else
        echo "Run xcode-select --install, wait for it to finish, then try again." >&2
        exit 1
      fi
    fi
    ;;
  Linux)
    pkg-config --exists gtk+-3.0 webkit2gtk-4.1 || {
      echo "Install the Linux system packages listed in README.md." >&2
      exit 1
    }
    flags+=(-tags webkit2_41)
    ;;
  *) echo "On Windows, run setup.ps1 in PowerShell. See README.md." >&2; exit 1 ;;
esac

wails_version=v2.17.1
go_bin=$(go env GOBIN)
if [ -z "$go_bin" ]; then
  go_bin="$(go env GOPATH)/bin"
fi
wails="$go_bin/wails"
if [ ! -x "$wails" ] || [ "$("$wails" version 2>/dev/null | sed -n '1p')" != "$wails_version" ]; then
  go install "github.com/wailsapp/wails/v2/cmd/wails@$wails_version"
fi

if [ "$mode" = "dev" ]; then
  "$wails" dev -skipbindings ${flags[@]+"${flags[@]}"}
else
  if [ -n "$target" ]; then flags+=(-platform "$target"); fi
  "$wails" build -trimpath -skipbindings ${flags[@]+"${flags[@]}"}
  echo "Build complete. Open the build/bin folder to find Shell Bay."
fi
