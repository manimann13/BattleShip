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

### 2026-11-01 - Teammate - How to run the project in a browser
**Prompt:** Just pulled the code from git. Is there a way to run it in a browser to see
what it looks like so far?
**Response summary:** Inspected the project folder and `package.json`. Explained it is a
Vite + TypeScript app, so `index.html` can't be opened directly. Run `npm install` (if
needed) then `npm run dev` and open the printed localhost URL (usually
`http://localhost:5173`). Also noted `npm run build` / `npm run preview`, `npm test`, and
`assets-preview.html` for viewing sprites.
**Files changed:** none

### 2026-11-01 - Teammate - Create this log file
**Prompt:** Create a log file to track all Claude conversations from me and my teammates.
**Response summary:** Created this file. Declined to fabricate earlier conversations
because no transcript exists. Added a placeholder section for teammates to fill in with
real history.
**Files changed:** `CLAUDE_LOG.md` (new)

### 2026-11-01 - Teammate - Recommend an approach for online 2-device play
**Prompt:** Two real players can currently only play on one device. How would you recommend adding a mode where they play on two different devices?
**Response summary:** Read `game.ts` and `types.ts`. Recommended an authoritative Node server with WebSockets (server holds both boards to prevent cheating), compared against WebRTC/PeerJS and Firebase, and listed deployment options.
**Files changed:** none

### 2026-11-01 - Teammate - Implement online mode (free hosting, over the internet)
**Prompt:** It needs to run over the internet using only free tools. Claude can write all the UI work.
**Response summary:** Added an Online mode: a Node + `ws` server (`server/`) that serves the built client and runs matches on `/ws`; shared message types and validation (`src/net/protocol.ts`); a browser connection wrapper (`src/net/connection.ts`); and the lobby, waiting and battle screens (`src/ui/online.ts`), which reuse the existing placement screen. Added host/join by 4-letter code, turn enforcement, rematch and disconnect handling. Added `Board.recordShot`, a Vite `/ws` proxy, `render.yaml` for Render's free plan, README instructions, and tests in `tests/room.test.ts`. Type-check, 37 unit tests and the build pass, and a two-client smoke test against the real server worked. It has not been tried in a real browser or deployed.
**Files changed:** `server/index.ts`, `server/room.ts`, `src/net/protocol.ts`, `src/net/connection.ts`, `src/ui/online.ts`, `src/ui/app.ts`, `src/ui/styles.css`, `src/game/board.ts`, `vite.config.ts`, `tsconfig.json`, `package.json`, `render.yaml`, `README.md`, `tests/room.test.ts`
