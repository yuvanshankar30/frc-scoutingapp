# Documenting a change

Every pull request updates these docs. This page is the how-to.

1. **Find the page.** Pages are sorted by where a thing lives in the site: one folder per menu group, one page per
   screen or tab (see [docs/README.md](../README.md)). Infrastructure goes in `architecture/`, contributor tooling in
   `development/`.
2. **Write or fix the text** so the page describes how it works *now*:
   - MAJOR: a new or rewritten page (or folder), added to `docs/README.md` and the folder's README.
   - MINOR: a new section on the page, or a new page for a new screen.
   - PATCH fix: correct anything the fix made wrong.
3. **Add a row to [VERSION.md](../VERSION.md)** that names the version, the date, what changed, and links the page.

Keep pages short and plain: what it does, where the code is, what tables or APIs it uses. Missing data is "—", never 0.
