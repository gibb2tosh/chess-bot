# ♞ Chess Coach

A personal game-review coach for chess.com. It does what the built-in reviews on chess.com and lichess do, and adds the parts they leave out:

- **Reviews your games after they finish.** Load your recent chess.com games, paste a PGN, or switch on auto-review: the app checks chess.com every minute and reviews each new game. A browser notification tells you when a review is ready.
- **Reviews your history in bulk.** *Review your history* queues your last 10–100 games and works through them in the background. It skips games already reviewed and aborted games, and shows progress, time remaining and a Cancel button. Games you click on jump the queue.
- **Explains *why* a move is good or bad.** For every move you get a plain-English reason, not just a label: *"Qe6 is an inaccuracy: it walks into Bxd7+, which forks the king and the queen on e6"*, *"Nf6 is a blunder: it allows Qxf7#"*, *"Castling was the priority here — your king is still in the centre"*. Each explanation comes with **ideas**: the engine's best line and the refutation of your move, which you can step through on the board.
- **Lets you play on from any position** against a bot set to your opponent's rating. *Retry this moment* puts you back before a mistake so you can try again. *Play from here* continues from the current position.
- **Learns what you do well and badly.** The Insights page combines all your reviews. It shows accuracy by game phase, the tactics you allow, the chances you miss, what you're good at, mistakes made in time trouble, how often you punish your opponent's errors, how often you convert winning positions, and your results by opening.
- **Shows whether you're improving.** Progress charts track accuracy, blunders and mistakes per game, and your most common mistake themes, by month (or by week or game group when your history is short). Your last 10 games are compared with the 10 before them.
- **Turns your mistakes into puzzles.** When a position had a clear best move that you missed, it's saved as a puzzle and comes back on a spaced-repetition schedule. The *Train similar patterns* section fetches lichess puzzles on the themes where you struggle (forks, pins, hanging pieces, defence, endgames, and openings you score badly in).
- **Optional Claude coach.** Add an Anthropic API key in Settings to get an *Ask Claude why* button. It sends the engine facts for that moment to Claude and returns a coach-style explanation.

Everything runs in your browser. Stockfish 19 runs locally as WebAssembly. Reviews are stored in IndexedDB (room for thousands of games), and settings and puzzles in `localStorage`. Nothing leaves your machine except calls to the public chess.com and lichess APIs, plus Anthropic if you turn on the Claude coach.

## Running it

```bash
npm install      # also copies the Stockfish WASM build into public/engine
npm run dev      # http://localhost:5173
```

Enter your chess.com username in **Settings** (or on the **Games** tab), load your games and click **Review**. At the default depth (14), a typical game takes about 30–60 seconds.

```bash
npm test         # unit tests + integration tests against the real Stockfish engine
npm run build    # static build in dist/ — host it anywhere (GitHub Pages, Netlify, …)
```

## The chess.com button (browser extension)

chess.com has no official add-on API, so this is a web app plus a small Chrome/Edge extension. The extension adds a **♞ Review with Chess Coach** button to chess.com game pages, **but only once the game is over**. Using engine analysis during a game breaks chess.com's fair-play rules. The button appears only when the game shows up in your public game archive, and chess.com only lists finished games there.

1. Open `chrome://extensions`, turn on *Developer mode*, click *Load unpacked* and select the `extension/` folder.
2. Click the extension icon. Enter your chess.com username and the app URL (`http://localhost:5173/` for `npm run dev`, or wherever you host the build).
3. After a game, the button appears within about 15 seconds of the game reaching your archive (usually a minute or so after it ends). Click it to open the review.

The button only appears on your own games, the ones in the archive of the username you set.

## How it works

| Piece | Where | Notes |
| --- | --- | --- |
| Engine | `src/lib/engine.ts` | UCI driver for Stockfish 19 (lite, single-threaded WASM) in a Web Worker. Tests run the same build in Node. |
| Move classification | `src/lib/classify.ts` | Uses the expected-points loss (win-probability drop, same model as lichess) to grade moves: best/excellent/good/inaccuracy/mistake/blunder. **Brilliant** = a sound sacrifice. **Great** = the only move that holds. **Miss** = failing to punish an opponent's error. |
| Explanations | `src/lib/explain.ts`, `src/lib/motifs.ts` | Board analysis built on chess.js: hanging pieces, forks, pins and skewers, discovered attacks, mate threats, back-rank mates, defending threatened pieces, development, castling, early queen moves, king-shelter weaknesses, doubled and isolated pawns, passed pawns, piece activity, trading when ahead. Engine lines are played out to measure what they win, and material claims are checked against the engine's evaluation. |
| Review | `src/lib/review.ts` | Evaluates every position (top 3 lines), then classifies and explains each move. Also computes accuracy, clock usage and key moments. |
| Review queue | `src/lib/reviewQueue.ts` | Runs every review (clicked, bulk, auto-watch) one at a time on a single engine, with jump-the-queue, cancel and progress/ETA. If the engine worker crashes, the queue starts a fresh engine for the next game. |
| Storage | `src/lib/reviewStore.ts` | IndexedDB. Reviews saved by the first version (in `localStorage`) are migrated automatically. |
| Progress | `src/lib/trends.ts` | Groups games by month, week or game group and compares recent games with earlier ones. Games under 5 moves are left out of stats. |
| Sparring bot | `src/lib/bot.ts` | Stockfish's own strength limiter plays unnaturally at club level. Instead, the bot takes the engine's top 5 moves and picks one with a softmax over how much each move loses. Lower ratings get a higher temperature, a shallower search and occasional plausible blunders. |
| Puzzles | `src/lib/puzzles.ts` | Picks positions where you missed a decisive or only-saving move and trims the engine line to its forcing part. Leitner boxes handle spaced repetition. During solving, the engine accepts any alternative move that works just as well. |
| Profile | `src/lib/profile.ts` | Combines reviews into strengths, weaknesses and the drills to recommend. |
| Data sources | `src/lib/chesscom.ts`, `src/lib/lichess.ts` | chess.com Published-Data API and lichess puzzle API. Both are public and work from the browser (CORS). |

## Licensing note

The app bundles Stockfish.js, which is GPL-3.0. If you distribute a build, the GPL applies to it.
