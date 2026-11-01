# Claude Conversation Log

Running record of conversations with Claude for this project. Add a new entry at the
bottom for each session. Paste real prompts and summarize real responses.

## Entry template

```
### YYYY-MM-DD - <name> - <short topic>
**Prompt:** what was asked
**Response summary:** what Claude did or said
**Files changed:** list, or "none"
```

---

## Earlier sessions (before this log existed)

No transcript is available for Claude sessions that happened before this log was started.
The existing code (Vite + TypeScript game logic in `src/game`, `src/ai`, `src/ui`, generated
sprites in `public/assets`, tests in `tests/`) was pulled from git.

> TODO (teammates): if you used Claude on earlier work, paste the actual prompts and a
> summary of the responses here, with dates and your names. Do not reconstruct from memory
> without saying so.

---

## Log

### 2026-11-01 - nferenck - How to run the project in a browser
**Prompt:** Just pulled the code from git. Is there a way to run it in a browser to see
what it looks like so far?
**Response summary:** Inspected the project folder and `package.json`. Explained it is a
Vite + TypeScript app, so `index.html` can't be opened directly. Run `npm install` (if
needed) then `npm run dev` and open the printed localhost URL (usually
`http://localhost:5173`). Also noted `npm run build` / `npm run preview`, `npm test`, and
`assets-preview.html` for viewing sprites.
**Files changed:** none

### 2026-11-01 - nferenck - Create this log file
**Prompt:** Create a log file to track all Claude conversations from me and my teammates.
**Response summary:** Created this file. Declined to fabricate earlier conversations
because no transcript exists. Added a placeholder section for teammates to fill in with
real history.
**Files changed:** `CLAUDE_LOG.md` (new)
