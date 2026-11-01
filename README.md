# Battle Ship

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
- [x] vs Computer mode: fires at random, hunts around a hit, follows the line after two hits
- [x] 2 Players mode: one screen, with a pass-the-device screen between turns
- [x] Pixel-art assets, redrawn from `docs/asset-sheet-reference.webp`
- [x] Effects: explosions, splashes, and sunk ships revealed
- [x] Mouse and keyboard controls, and phone-width layout
- [x] Settings screen: computer speed, animations, grid labels
- [x] Online mode: two devices play over the internet through a WebSocket server (see Online play below)
- [x] Unit tests for the rules, computer player and saved settings

### Left

- [ ] Testing: Safari, Firefox, a real phone, and a vs Computer game played through to a win
- [ ] Deployment: deploy to Render (see Online play below) and play a real two-device game
- [ ] General UI improvements, if there's time

### Optional

- [ ] Review the code already merged (it was merged without a review)
- [ ] Finish this README: what the game is, how to run it, how to test it
- [ ] Add sound (no audio files yet; the icons are in `public/assets`)
- [ ] Add automated checks on GitHub to run the tests on pull requests
- [ ] Add automated tests for the screens

## Online play

Online mode uses a small Node server (`server/`) that holds both boards, so a player never receives the opponent's ship positions. The browser only sends `ready` (its fleet) and `fire` messages. The message types are in `src/net/protocol.ts`.

**Run it locally (two terminals):**

```bash
npm run server   # game server on http://localhost:3001
npm run dev      # client on http://localhost:5173, forwards /ws to the server
```

Open the game in two browser windows, choose Play, then Online. Host in one window and join with the 4-letter code in the other.

**Deploy for free on Render:**

1. Push the code to GitHub. On render.com choose New, then Blueprint, and select the repository. `render.yaml` sets everything up.
2. Render builds the client and runs one server that serves both the page and the WebSocket. Share the `onrender.com` link.
3. The free plan sleeps after about 15 minutes idle, so the first connection can take up to a minute.
