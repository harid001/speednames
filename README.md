# Speednames

A tiny self-hosted server for **Speednames** — a fast party variant of [Codenames](https://en.wikipedia.org/wiki/Codenames_(board_game)) with a shared TV/board view, a private spymaster key, a per-turn timer, and an optional drinking mechanic. Anyone can create a game and get two shareable links; games are isolated from each other, so many groups can play at once. State (words, colors, reveals, timer, shots) lives in a SQLite file (`speednames.db`) created automatically next to the server, so games survive restarts.

## Setup

1. Install [Node.js](https://nodejs.org) (v18+).
2. In this folder:
   ```
   npm install
   npm start
   ```
3. Open the printed URL (defaults to `http://localhost:3000`).

## Configuration

The shareable board/spymaster links (and their QR codes) are **derived from the incoming request** — the `Host` header and scheme — so they're correct automatically whether you open the app at `localhost`, a LAN IP, or a public domain behind a reverse proxy / Cloudflare Tunnel. No configuration needed for hosting.

Two conveniences:
- Opening the app on the **host machine itself** (`localhost`) substitutes the machine's **LAN IP** into the shared links, so other devices on the same wifi can reach them.
- The server trusts a **loopback** proxy (`X-Forwarded-Proto`), so links come out `https://` behind Cloudflare Tunnel / nginx on the same host.

Environment variables (both optional):

- `PORT` — port to listen on (default `3000`).
- `BASE_URL` — force a canonical origin, e.g. `https://speednames.example.com`. Only needed if request-derivation ever guesses wrong (unusual setups); leave it unset behind Cloudflare Tunnel.

## Using it

- Open `/`, set a **turn timer**, and hit **Create Game**. The 25 words are drawn at random from the `words` file (edit that file to change the pool).
- You land on a **share hub** with two links, each with a QR code and a Copy button:
  - **Board link** (`/board/<id>`) — the public TV/guessing view. Share with everyone or open on the TV. Tapping a word locks in the guess for all watchers.
  - **Spymaster link** (`/spymaster/<token>`) — the color-coded key. Give this only to your spymaster (both teams' spymasters share it). The board link never exposes the key: colors are only sent behind the secret spymaster token.
- The two links use independent unguessable tokens, so holding the board link never reveals the spymaster key. Bookmark the share hub — it's the only page that shows both links, and it doubles as your "Play again" button.
- **Multiple games at once:** every Create Game mints a fresh, isolated game with its own links. Different groups never see or affect each other.
- **Turns:** each turn belongs to one team with a single timer. **Next Turn** flips to the other team and resets the clock. The color-coded banner (on both views) shows whose turn it is.
- **Timer:** Start / Pause / Reset live on the board (TV) page. All views poll once a second, so timers and reveals stay in sync across devices.
- **Shots (optional drinking mechanic):** the 🥃 buttons (on both the board and spymaster views) add a minute to the timer and tally a shot — one for the spymaster, one for the guessers. House rule shown in the UI: a guessers' shot earns the team one extra guess.
- **Winning / game over:** when a team's tiles are all revealed, the banner announces the win; revealing the assassin ends the game with a game-over banner. (This is display only — start a new round with "Play again".)
- **Play again:** the share hub's "Play again" button deals a new board (fresh words + colors, cleared reveals/timer/shots) while keeping the same links, so the group doesn't need to re-share.

## Deploying to a VPS

1. Copy the project to the server and `npm install` (this compiles `better-sqlite3`; the box needs a C toolchain — `build-essential` on Debian/Ubuntu).
2. Run it under a process manager (e.g. `pm2`, `systemd`):
   ```bash
   PORT=8080 node server.js
   ```
3. Expose it. With **Cloudflare Tunnel**, point a public hostname at the local port — no ports opened on the VPS, TLS handled by Cloudflare, and links are derived automatically (no `BASE_URL` needed):
   ```yaml
   # ~/.cloudflared/config.yml
   ingress:
     - hostname: speednames.example.com
       service: http://localhost:8080
     - service: http_status:404
   ```
   (Or put any reverse proxy — nginx/Caddy — with TLS in front of the port.)
4. **Rate-limit game creation at the edge.** There's no auth, so add a Cloudflare WAF rate-limiting rule scoped to `POST /new` (e.g. a handful of requests per IP per minute) to stop someone spamming new games. The free plan includes a basic rate-limiting rule.

## Data / reset

Everything is stored in `speednames.db` in this folder (ignored by git). Each game is one row keyed by a random id, with a separate secret spymaster token. Delete `speednames.db*` to wipe all games; a fresh database is created on the next start. There is no automatic cleanup yet — games accumulate until you delete the file (each is ~1 KB).

Note: there is no authentication. Anyone with a game's board link can view and operate that board, and anyone with its spymaster link can see the key. Security rests entirely on the links being unguessable, which is fine for a party game but worth knowing before hosting publicly.

## Troubleshooting

- **`npm install` fails on `better-sqlite3`**: it compiles a native module. On Mac run `xcode-select --install` once; on Debian/Ubuntu install `build-essential`; on Windows install the "Desktop development with C++" workload.
- **Other devices can't connect (same-wifi play)**: confirm they're on the same wifi and your firewall allows inbound connections on the port (Mac usually prompts the first time).
