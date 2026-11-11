# Scouting forms

Each season's built-in scouting forms, one folder per game. The app loads the current season's files
(`src/lib/scouting/forms/formSchema.js`); everything else about a form is changed on the site in
**Scouting Admin > Edit**.

| File | What it holds |
| --- | --- |
| `2026-rebuilt/match.json` | Match scouting: its sections and the built-in questions in each |
| `2026-rebuilt/pit.json` | Pit scouting, the same way |

## The format

```json
{
  "format": "frc-scouting-form",
  "formatVersion": 1,
  "game": "2026 REBUILT",
  "form": "match",
  "label": "Match scouting",
  "sections": [
    { "id": "teleop", "label": "Teleop", "blocks": [{ "key": "teleop.balls", "label": "Balls scored", "required": true }] }
  ],
  "design": { "questions": [], "core": {}, "order": {} }
}
```

- `sections` and their `blocks` are the season's built-in questions: a section id, a block key, its wording, help
  text and whether it starts out required.
- `design` is what the designer adds on top: new questions (`questions`), changes to built-in questions (`core`:
  wording, hidden, required, looks) and the order of each section (`order`). The repo's files keep it empty.

**Export** in the designer downloads the form being edited in this same format, with its `design` filled in.
**Import** loads such a file into the draft; questions or built-in changes this app can't read are left out and
listed. Nothing goes live until it is published.
