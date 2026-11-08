# Battle Ship

**Play it live: https://battleship-7pbl.onrender.com/**

Hosted on Render's free plan, so the first visit after about 15 minutes idle can take up to a minute to load.

## Workflow

Everyone works on their own branch, named after them, and merges into `main` through a pull request. Nobody commits directly to `main`.

1. Get the code (first time only), then install:

   ```bash
   git clone https://github.com/manimann13/BattleShip.git
   cd BattleShip
   npm install
   ```

2. Create your branch from the latest `main`, using your name. For example, Mani's branch is `Mani_branch`:

   ```bash
   git checkout main
   git pull
   git checkout -b YourName_branch
   ```

3. Make your changes. Run the game with `npm run dev`, and run the tests before pushing:

   ```bash
   npm test
   ```

4. Commit and push your branch:

   ```bash
   git add <files>
   git commit -m "Describe your change"
   git push -u origin YourName_branch
   ```

5. Open a pull request into `main` on GitHub.

6. Before starting your next task, update your branch from `main`:

   ```bash
   git checkout main
   git pull
   git checkout YourName_branch
   git merge main
   ```

## Roadmap

### Done

- [x] Game rules: 10x10 board, five classic ships, one shot per turn, win detection
- [x] Ship placement: click to place, rotate, random, undo, valid and invalid previews
- [x] vs Computer mode with three difficulties: Easy fires at random (about 96 shots to win), Normal hunts around hits (about 60), Hard aims where ships are most likely to be (about 45)
- [x] 2 Players mode: one screen, with a pass-the-device screen between turns
- [x] Pixel-art assets, redrawn from `docs/asset-sheet-reference.webp`
- [x] Effects: explosions, splashes, and sunk ships revealed
- [x] Mouse and keyboard controls, and phone-width layout
- [x] Settings screen: computer speed, animations, grid labels, sound, music
- [x] Sound effects for miss, hit and sunk, plus a click for buttons (all synthesized, no audio files), with a mute button on the battle screen
- [x] Music: an original sea shanty on the menus and a march in battle, synthesized in `src/ui/music.ts`, with a music button beside the mute button. It starts after the first tap or key press, because browsers block sound before that
- [x] Animated pixel radar on the online waiting screens (connecting, game code, fleet ready)
- [x] Main menu artwork: an animated sea battle in pixel art behind a gold title. Your ships fly blue flags (left), the enemy's red (right). Click the sea to fire: each hit leaves a burning scar, and the fifth blows the ship up and sinks it. Click the moon for a sunny day, and the sun for night again (remembered in the browser). Settings and How to Play open on the same scene
- [x] End-of-game stats: shots, hits, accuracy, ships sunk, longest hit streak, time played, plus a win/loss record saved in the browser
- [x] Online mode: two devices play over the internet through a WebSocket server (see Online play below)
- [x] Online reconnecting: a dropped player has 60 seconds to come back, automatically or with Rejoin after a reload
- [x] Online quick messages: a message button opens Good luck!, Nice shot!, Wow! and Good game! (no free-text chat, so nothing to moderate)
- [x] Loading screen: a pixel radar and progress bar while the fonts and sprites load
- [x] Link preview: title, description and `public/og-image.png` for chats and social sites. To redraw the image, run `npm run og-image` while `npm run dev` is running
- [x] Installable app: add it to a home screen from the browser menu. After the first visit it opens and plays vs Computer and 2 Players offline (the build writes `dist/sw.js` listing every file to cache)
- [x] Easter eggs: see Secrets below
- [x] Unit tests for the rules, computer player, stats, saved settings and record, protocol parsing, and the online room
- [x] Automated checks: GitHub runs the tests and the build on every pull request (`.github/workflows/test.yml`)
- [x] Deployment: live on [Render](https://battleship-7pbl.onrender.com/)

### Left

- [ ] Testing: a real two-device game (including reconnecting on a phone), Safari, Firefox, a real phone, and a vs Computer game played through to a win
- [ ] General UI improvements, if there's time
- [ ] Some more general things

### Optional

- [ ] Review the code already merged (it was merged without a review)
- [ ] Finish this README: what the game is, how to run it, how to test it
- [ ] Add automated tests for the screens

## Secrets

Spoilers for players, notes for the team:

- **The Kraken:** on the main menu, shoot your own (blue-flagged) ships. There is no warning: the third friendly hit wakes the kraken, which drags that ship under. Typing the Konami code (↑ ↑ ↓ ↓ ← → ← → B A) sends it after an enemy instead.
- **Gold Anchor:** win a game without missing a single shot. It is saved in the browser and shown under the title. It is extremely rare: all 17 shots have to hit.

## Online play

Online mode uses a small Node server (`server/`) that holds both boards, so a player never receives the opponent's ship positions. The browser sends its fleet, its shots, rematch requests and emotes. The message types are in `src/net/protocol.ts`.

**Reconnecting:** when a player joins, the server gives them a secret token, which the browser keeps for that tab. If the connection drops, the server holds the seat for 60 seconds and the opponent sees a waiting message. The browser retries on its own, and after a page reload the main menu shows **Rejoin Online Game**. On return the server sends the whole match so far, so the boards and stats are rebuilt. Pressing Quit leaves straight away.

**Quick messages:** online only. The message button next to the sound button opens four preset messages: Good luck!, Nice shot!, Wow! and Good game!. The list is in `src/net/protocol.ts` (`EMOTES`). The server rejects anything else and drops messages sent less than 1.5 seconds apart.

**Run it locally:**

```bash
npm run dev      # the game on http://localhost:5173, and the game server on port 3001
```

`npm run dev` starts the game server for you. If one is already running (for example from `npm run server`), it uses that one instead.

Open the game in two browser windows, choose Play, then Online. Host in one window and join with the 4-letter code in the other.

**Deploy for free on Render:**

1. Push the code to GitHub. On render.com choose New, then Blueprint, and select the repository. `render.yaml` sets everything up.
2. Render builds the client and runs one server that serves both the page and the WebSocket. Share the `onrender.com` link.
3. The free plan sleeps after about 15 minutes idle, so the first connection can take up to a minute.
