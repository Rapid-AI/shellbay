# Shell Bay

Shell Bay is a desktop SSH client with a two-pane file manager and direct sharing between teammates. It stores connections and credentials in an encrypted vault on your computer.

## Download and run

| Your computer | Download | After downloading |
| --- | --- | --- |
| Mac with Apple silicon or Intel | [macOS ZIP](releases/ShellBay-1.0.0-macos-universal.zip) | Double-click the ZIP, then open `shellbay.app`. |
| 64-bit Windows PC (Intel or AMD) | [Windows x64 ZIP](releases/ShellBay-1.0.0-windows-x64.zip) | Right-click the ZIP, choose **Extract All**, then open `ShellBay.exe`. |
| Linux PC (Intel or AMD) | [Linux x64 tar.gz](releases/ShellBay-1.0.0-linux-x64.tar.gz) | Install the runtime packages below, then extract and run the app. |
| Linux computer (ARM64) | [Linux ARM64 tar.gz](releases/ShellBay-1.0.0-linux-arm64.tar.gz) | Install the runtime packages below, then extract and run the app. |

[SHA-256 checksums](releases/SHA256SUMS.txt)

- On macOS, select **Apple menu → About This Mac** to see your processor. The macOS download includes both architectures and requires macOS 12 or newer. The app has an ad hoc signature. Apple notarization is pending. If macOS blocks the download, use the [Apple instructions for opening a trusted app](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/mac) or build it locally using the steps below.
- On Windows, select **Settings → System → About** and look for **System type**. Shell Bay uses the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
- On Linux, run `uname -m`. Choose x64 for `x86_64` and ARM64 for `aarch64`. On Debian 12 and later or Ubuntu 24.04 and later, install the desktop runtime packages in a terminal.

  ```sh
  sudo apt update
  sudo apt install libwebkit2gtk-4.1-0
  ```

  Extract the archive with your file manager and open the `ShellBay` file. From the extracted folder in a terminal, you can run `./ShellBay`.

## What you can do

- Save SSH hosts with groups, tags and favorites. Connect with a password, SSH key or agent, use jump hosts and verify server fingerprints.
- Open terminal tabs, search their output, record sessions, use command suggestions and run saved snippets or multi-step flows.
- Browse and transfer files between local folders and servers. The two-pane file manager supports SFTP and plain FTP, name conflicts, single-file resume, ZIP archives, an editor and one-way folder sync with preview. Long lists render only the visible rows.
- Set up local, remote and SOCKS5 tunnels. Export or import selected data, import hosts from `~/.ssh/config` and share access with teammates over a LAN or VPN.
- Install themes, JavaScript plugins and JSON command dictionaries. New profiles start in English. You can change the language in Settings.

The master password protects the vault with Argon2id and AES-256-GCM. Plain FTP sends credentials and data without TLS. The local interactive shell is available on macOS and Linux. Windows can open remote SSH terminals.

[User guide](docs/user-guide.md) · [Themes](docs/themes.md) · [Plugins](docs/plugins.md) · [Command dictionaries](docs/dictionaries.md)

## Build it yourself

You need the source folder, Go and Node.js. Choose the instructions for the computer that will run the app.

### 1. Get the source

On the GitHub repository page, choose **Code → Download ZIP**. Extract it and open the folder that contains `README.md`, `go.mod` and `wails.json`. If you already have that folder, use it.

### 2. Install Go and Node.js

1. Install [Go](https://go.dev/dl/). Use Go 1.26.11 or newer to build Shell Bay.
2. Install [Node.js LTS](https://nodejs.org/en/download). Use Node.js 22 or newer. Its installer includes npm.
3. Close and reopen your terminal. Type these three commands, one at a time. Each should print a version number. In PowerShell, use `npm.cmd --version` for the npm check.

   ```text
   go version
   node --version
   npm --version
   ```

### 3. Follow the steps for your computer

#### macOS

1. Open **Terminal**. Run `xcode-select --install` and finish the installer if macOS shows one.
2. Type `cd ` (including the space). Drag the extracted source folder from Finder into Terminal, then press Enter.
3. Run the build command.

   ```sh
   bash ./setup.sh
   ```

4. In Finder, open the source folder, then **build → bin**. Double-click **shellbay.app**. To build one app for both Apple silicon and Intel, run `bash ./setup.sh build darwin/universal` instead.

#### Windows 10 or 11

1. Install the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) if it is missing. Choose the **Evergreen Bootstrapper**.
2. Open the extracted source folder in File Explorer. Click the address bar, type `powershell` and press Enter.
3. Run the build command.

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
   ```

   This policy flag applies only to the PowerShell process that runs the build script.

4. In File Explorer, open **build → bin**. Double-click **ShellBay.exe**.

#### Linux (Debian 12 or Ubuntu 24.04 and later)

1. Open a terminal. Install the dependencies that compile the desktop app.

   ```sh
   sudo apt update
   sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev
   ```

   For another distribution, look up the equivalent GTK 3 and WebKitGTK 4.1 development packages in the [Wails Linux guide](https://v2.wails.io/docs/guides/linux-distro-support/).
2. Open a terminal in the extracted source folder. Build the app and launch it.

   ```sh
   bash ./setup.sh
   ./build/bin/ShellBay
   ```

The setup script installs the pinned Wails CLI and downloads dependencies on the first build. If a command fails, use the first error in the terminal to identify the missing prerequisite. Run the same build command again after installing it.

## First launch

Create a master password, then select **Vaults → Hosts → New host**. Enter a host you already have access to, save it and double-click it to connect. At the first SSH confirmation, compare the fingerprint with the one supplied by the server administrator.

## License

Shell Bay is available under the [PolyForm Noncommercial License 1.0.0](LICENSE). For commercial use, request a separate license from the repository owner. Bundled dependencies retain their own terms. [Third-party notices](THIRD_PARTY_NOTICES.txt)
