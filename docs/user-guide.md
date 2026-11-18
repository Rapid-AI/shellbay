# Use Shell Bay

## Create a vault and connect

1. Open Shell Bay and create a master password. You need this password to reopen the vault. Keep a copy somewhere safe.
2. Open **Vaults → Hosts**, add a host and enter its address, username and authentication details. You can use a password, an SSH key or your SSH agent.
3. Double-click the host. On first connection, compare the fingerprint shown by Shell Bay with the fingerprint provided by the server administrator. Verify any changed fingerprint before trusting it.

The vault is encrypted with a key derived using Argon2id and stores its data with AES-256-GCM. Its backup, `vault.hrb.bak`, is next to the vault file in the app data folder. Themes, plugins, transfer metadata and session logs are stored outside the encrypted vault. Use **Lock** to close active connections and lock the vault.

## Find the tools you need

| Tool | What it does |
| --- | --- |
| Hosts | Filter by group or tag, mark favorites, choose a list or grid, configure jump hosts and set startup commands. The status probe checks the saved TCP port. |
| Terminal | Run commands, find text in the output, open tabs and send input to several sessions with **Broadcast input**. The local terminal is available on macOS and Linux. |
| Keychain | Generate or import SSH keys and install a public key on a saved host. |
| Forwarding | Start or stop local and remote port forwarding or start a SOCKS5 tunnel. |
| Snippets and flows | Reuse single commands or run sequences of commands, prompts, waits and file transfers. Inspect any imported flow before running it. |
| Logs | View terminal session logs if recording is enabled. A log can contain sensitive terminal output. |
| Settings | Change language, appearance and terminal options, manage extensions, import OpenSSH configuration and import or export bundles. |

Use **Ctrl+K** on Windows or Linux and **⌘K** on macOS for quick host selection. Terminal suggestions combine built-in entries, enabled extensions, usage history and available SSH help output. For eligible command names in a remote terminal, the app can run `<command> --help` in a separate SSH session to obtain suggestions.

## Move and synchronize files

Open **File manager** and select the location for each pane. Locations can be local folders, SFTP hosts or FTP hosts. Use SFTP for private data. Plain FTP sends credentials and file contents without TLS.

- Select files and press **F5** to copy or **F6** to move them. **Skip** preserves conflicting files at the source during a move. **Keep both** gives the incoming item a new name.
- Use the transfer queue to track progress, cancel jobs, or resume an interrupted single file when a partial copy is available. Reopen the original endpoints after restarting the app. Retry the same transfer with **Replace** to use a matching saved resume record. If the file has changed, clear the saved record in Settings before starting over.
- To synchronize a folder, invoke **Sync with the other pane…** from the source pane. Review the one-way plan before applying it. Select removal actions only if the destination should lose its extra files.
- Press **F4** to open a text file in the editor. Use the file menu for ZIP creation or extraction. The list renders visible rows as you scroll through large directories.

## Exchange saved connections

Use **Settings → Import/Export** to move data between installations. Use a password-protected `.shellbay` export when including secrets. Plain JSON omits stored credentials but can include host details, notes, snippets and flow text.

For direct sharing, open **Vaults → Team** on both computers. Enable receiving, create an invite on one computer and paste it into the other. The invite can be used once and expires after 10 minutes. Once paired, choose the data to send and confirm the offer on the receiving device. Both computers need a reachable network path, such as the same LAN or VPN.

## Customize the app

The built-in **Classic** and **Simple** themes include light and dark versions. See the guides for [themes](themes.md), [JavaScript plugins](plugins.md) and [command dictionaries](dictionaries.md).
