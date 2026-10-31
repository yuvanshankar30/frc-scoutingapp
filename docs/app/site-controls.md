# Site controls

Every dropdown is `Select`, dates use `DatePicker`, teams use `TeamPicker`, confirmations use `requestConfirmation()`,
and messages are toasts. Never a native `<select>`, date input, `confirm()` or `alert()`; a test
(`src/lib/ui/siteControls.test.js`) enforces it. Details and the full table are in
[code conventions, "UI rules"](../development/conventions.md#ui-rules).

Nothing important lives only in a hover tooltip: column meanings, percentages and notes are written out on the page.

A dropdown's list never cuts a choice off: long choices wrap, and the list can be up to 32rem wide. Add `wrapText` to a `Select` whose button should wrap long choices too (for example Match Scouting's Competition picker).

Phones get their own screens: see [phone layout](phone-layout.md).

