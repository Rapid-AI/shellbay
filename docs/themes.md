# Create a Shell Bay theme

1. Download [Midnight Violet](../examples/themes/midnight-violet.json).
2. In Shell Bay, open **Vaults → Settings → Appearance → Install theme…** and select the JSON file.
3. Select **Midnight Violet** in the theme gallery. Change a color in the file, then install it again to see the update.

```json
{
  "id": "midnight-violet",
  "name": "Midnight Violet",
  "base": "dark",
  "colors": {
    "bg": "#120a1f",
    "accent": "#a855f7",
    "on-accent": "#ffffff"
  }
}
```

## Manifest

| Field | Meaning |
| --- | --- |
| `id` | Unique ID, up to 64 characters. Start with a lowercase letter or digit. Use lowercase letters, digits and hyphens. Installing the same ID again updates the theme. |
| `name` | Name shown in the gallery. |
| `base` | `"dark"` or `"light"`. Unspecified tokens inherit their values from this base. |
| `colors` | Map of tokens to CSS color values, for example `"#a855f7"` or `"rgb(168 85 247)"`. |
| `author` | Optional author name. |
| `family` | Optional ID shared by a light theme and a dark theme. The appearance setting can select the member matching the system preference. |
| `radii` | Optional map of corner-radius tokens to CSS lengths. |
| `terminal` | Optional reserved field. Shell Bay currently uses the separate terminal color setting. |

The built-in IDs are `classic-dark`, `classic-light`, `simple-dark` and `simple-light`. The built-in family IDs are `classic` and `simple`.

## Color and radius tokens

| Tokens | Where they appear |
| --- | --- |
| `bg`, `rail` | Window and navigation backgrounds |
| `panel`, `panel-2`, `panel-3` | Surfaces, from main panels to menus |
| `hover`, `line`, `line-soft` | Hover surface and borders |
| `text`, `muted`, `faint` | Primary, secondary and low-emphasis text |
| `accent`, `on-accent` | Accent fill and text on that fill |
| `accent-soft`, `accent-text` | Tinted selection background and its text |
| `input-bg` | Text fields and recessed elements |
| `ok`, `warn`, `danger` | Success, warning and error colors |
| `scroll-thumb`, `scroll-thumb-hover` | Scrollbar thumb in its normal and hovered states |

Radius tokens are `shape-xs`, `shape-sm`, `shape-md`, `shape-lg`, `shape-xl` and `shape-full`. For example, `"radii": {"shape-md": "10px"}`.

The theme engine applies these values as CSS custom properties, so the same tokens affect all screens that use them. The app's layout and the terminal palette are configured separately.
