# Phone layout

Phones get their **own markup**, not a squeezed desktop page. Pages branch on `$isPhone` (`src/lib/stores/device.js`,
the same 900px switch as the app shell).

- **Shell:** a 60px bottom bar (Home · Scout · My Reports · a role-based slot for Drive Team, Pit Crew or Strategy ·
  More). The More sheet is grouped by section with each page's description. The top strip clears the notch.
- **Install:** a web app manifest, so "Add to Home Screen" opens standalone, and `viewport-fit=cover` with safe-area
  tokens.
- **Sizes:** tap targets at least 44px (`--tap-min`), text at least 12px, form fields at least 16px (so iOS doesn't
  zoom), no horizontal page scroll, no cut-off text (it wraps). One-screen pages use `--screen-avail`.
- **Patterns:** lists that open a `BottomSheet` instead of side panels, cards instead of wide tables, one main action
  docked above the bottom bar.

Pages with their own phone screens: Home and My Reports (one screen each), Match Scouting (slim sticky kind bar and
stage stepper; the screen stays awake), Strategy, Match View, Pit Scouting, Drive Team, Pit Crew, Quick Scout, Scouting
Admin Overview and Data, and Team View (two-column grid).

Every UI change updates the phone screens too, checked at 375px and 1440px
([code conventions, "UI rules"](../development/conventions.md#ui-rules)).

