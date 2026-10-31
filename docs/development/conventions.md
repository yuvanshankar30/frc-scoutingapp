# Code conventions

What keeps the codebase consistent and the checks passing.

## Formatting

All code goes through Prettier. **Run `npm run format` after every code change.**

- The config lives in `prettier/` (`prettierrc.json` and `prettierignore`); `npm run format` and
  `npm run format:check` point Prettier at it. It formats everything in `src/` (JS, Svelte, CSS).
- `npm test` fails if any file in `src/` isn't formatted (`src/lib/docs/formatting.test.js`); the fix is always
  `npm run format`.
- Don't add folder names to `prettier/prettierignore`: patterns there match at any depth.

## Database changes

- Every schema change is a **new** file in `supabase/migrations/` named `YYYYMMDDHHMMSS_what_it_does.sql`. Never edit a
  migration that has already been applied somewhere.
- New tables get row-level security on, `revoke all ... from anon, authenticated`, explicit grants, and policies that
  require `public.approved_user()` for any scouting data.
- Server routes that use the service-role client (`getSupabase()` from `src/lib/server/serviceClient.js`) must check
  the caller first (`src/lib/server/scouting/scoutingAccess.js`), because that client bypasses row-level security.

## UI rules

The app has its own controls. **Never use the browser's or the OS's built-in pickers or dialogs:** they look different
on every phone and computer and ignore the theme.

| Need | Use | Never |
| --- | --- | --- |
| Dropdown / select | `$lib/components/common/Select.svelte` | a raw `<select>` |
| Date | `$lib/components/common/DatePicker.svelte` | `<input type="date">` / `datetime-local` |
| Picking a team | `$lib/components/common/TeamPicker.svelte` | a long `<select>` of teams |
| "Are you sure?" | `requestConfirmation()` from `$lib/app/confirmation.js` | `window.confirm` |
| Messages | toasts (`$lib/app/toast.js`) or an inline notice | `alert()` |
| Popups, sheets | `Dialog.svelte`, and on phones `BottomSheet.svelte` | hand-rolled fixed overlays |

`Select` is a drop-in for `<select>`: the same `bind:value`, `on:change`, `disabled` and `<option>` children, with a
themed popup and a search box once there are more than 8 options. A test (`src/lib/ui/siteControls.test.js`) fails if a
native `<select>` or date input appears outside these components.

- **Colors, spacing and type come from the tokens in `src/app.css`** (`--surface-*`, `--text-*`, `--accent*`,
  `--space-*`, `--radius-*`, `--chart-*`), never hard-coded colors in components. The brand color from Team settings
  overrides the `--accent*` tokens. Every screen must work in the light and dark themes.
- **Nothing important only on hover:** touch screens can't hover.
- **Every UI change updates the phone UI too.** Branch on `$isPhone` (`$lib/stores/device.js`) for phone screens; check
  at 375px and 1440px. Tap targets at least 44px, text at least 12px, form fields at least 16px, no horizontal scroll.
- **No cut-off text on phones.** A `text-overflow: ellipsis` rule needs a phone override marked
  `Phone: wrap, never cut text`. The site-controls test enforces this.
- **Missing data is "—" or "not scouted", never 0.**
- **Never hardcode a team.** Use `$ourTeamKey` / `$ourTeamNumber` from `$lib/stores/team.js` in the browser and
  `loadTeamSettings()` from `$lib/server/teamSettings.js` on the server.

## Versioning

The version is in [VERSION.md](../../VERSION.md) (newest first) and `package.json`. Every change adds a row
([semantic versioning](https://semver.org)): MAJOR for a big feature or anything people must do differently, MINOR for a
new feature or noticeable change, PATCH for fixes, copy, refactors and docs.
