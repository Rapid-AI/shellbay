# Write a Shell Bay plugin

Shell Bay plugins add flags and subcommands to the terminal suggestion list. For a set of fixed suggestions, use a [JSON command dictionary](dictionaries.md). Use JavaScript when you need to generate suggestions programmatically.

1. Download [Terraform suggestions](../examples/plugins/terraform-suggest.json).
2. Open **Vaults → Settings → Plugins → Install plugin…** and select the JSON file.
3. Open a terminal and type `terraform ` with a trailing space. The plugin supplies entries such as `plan` and `-auto-approve`. You can try the suggestions in a local or SSH terminal before installing Terraform.

## Manifest and API

```json
{
  "id": "example-suggest",
  "name": "Example suggestions",
  "version": "1.0.0",
  "capabilities": ["suggest.commands"],
  "code": "shellbay.registerSuggestSource(async ({ command }) => command === 'mytool' ? [{ flag: '--dry-run', desc: 'Preview changes' }] : []);"
}
```

- `id` is a unique slug of up to 64 characters. Start with a lowercase letter or digit, then use lowercase letters, digits and hyphens. Reinstalling with the same ID updates the plugin.
- `name` and `version` are displayed in Settings. `author` is optional.
- Declare `suggest.commands` in `capabilities`. It is the supported plugin capability.
- Put JavaScript in the `code` string, up to 256 KiB. The plugin should provide either `code` or a dictionary under `commands`.

Call `shellbay.registerSuggestSource` once. The callback receives `{ command, partial }`. The command is the first token currently being typed and the partial is the unfinished suggestion token. Return an array of `{ flag, desc }` objects or an empty array for commands outside the plugin's scope. Shell Bay caches results by command in each terminal, so return the full list for that command and let the UI filter it as the user types. A request waits up to 300 ms. Reopen a terminal after changing a plugin to start with a fresh suggestion cache.

## What JavaScript can access

Each plugin runs inside a Web Worker after the vault unlocks. The Worker receives the command and partial text and has no direct access to the vault, DOM, or native methods exposed through Wails. It can make network requests, so a plugin can transmit the text it receives. Install JavaScript plugins you trust and use a JSON dictionary for suggestions that only need static data.
