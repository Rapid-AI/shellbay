# Add a command dictionary

A dictionary is a JSON plugin containing a list of suggested flags and subcommands. Shell Bay reads the data directly without creating a JavaScript Worker for it.

1. Download the [kubectl dictionary](../examples/dictionaries/kubectl.json).
2. Open **Vaults → Settings → Plugins → Install plugin…** and select the file.
3. Open a new terminal and type `kubectl ` with a trailing space. Type `kubectl --` to narrow the list to flags. Press Escape to dismiss the list.

## Create your own

Copy the example into a plain-text editor and save it as `mytool.json`.

```json
{
  "id": "mytool-dictionary",
  "name": "My tool dictionary",
  "version": "1.0.0",
  "capabilities": ["suggest.commands"],
  "commands": {
    "mytool": [
      { "flag": "status", "desc": "Show current status" },
      { "flag": "--dry-run", "desc": "Preview changes" }
    ]
  }
}
```

Add more commands as keys in `commands`. Each key must match the first token typed in the terminal and may contain up to 40 ASCII letters, digits, underscores, dots, slashes or hyphens. Give it at least one suggestion. Use a single-line `flag` string and a short `desc` for each entry. The entire dictionary can be up to 256 KiB. Save the file as UTF-8 JSON without comments or trailing commas.

Install the edited file again to update it. Keep the same ID for updates and use a different ID to install two dictionaries side by side. Settings lists dictionaries alongside JavaScript plugins and provides the same enable and delete controls. The terminal merges dictionaries with built-in suggestions, available SSH help output, and suggestions from enabled JavaScript plugins.
