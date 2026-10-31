# Scouting Admin: Edit forms

Edit lets an admin add questions (tap buttons, multiple choice, checkboxes, dropdowns, yes/no, ratings, counters,
numbers, short and long text) to any section of the match and pit forms, reorder or delete them, and publish. The
built-in questions are fixed because they feed analytics. Published versions are immutable rows in
`scouting_form_versions` (the highest number is live; restoring an old one publishes it again as a new version), the
work in progress is one row per form in `scouting_form_drafts`, and answers are stored in `custom_answers` on the report
together with the `custom_form_version` they were answered against. API: `/api/scouting-forms`; editor:
`src/lib/components/forms/FormEditor.svelte`; shared rules: `src/lib/scouting/forms/`.

