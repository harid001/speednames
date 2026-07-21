const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'speednames.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const DEFAULT_TURN_SECONDS = 30;

// One game = one board, addressed by two random tokens:
//   id             — public board id, shared with all players (/board/<id>)
//   spymaster_token — secret, given only to the spymaster (/spymaster/<token>)
// A game is a series of timed turns that alternate between team A and team B;
// each turn uses a single timer (turn_seconds).
db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,                    -- public board id (random)
    spymaster_token TEXT NOT NULL UNIQUE,   -- secret spymaster token (random)
    words TEXT NOT NULL,           -- JSON array of 25 words
    colors TEXT NOT NULL,          -- JSON array of 25 team labels ("A","B","NEUTRAL","ASSASSIN")
    revealed TEXT NOT NULL,        -- JSON array of 25 booleans
    starting_team TEXT NOT NULL,   -- 'A' | 'B'
    active_team TEXT NOT NULL,     -- 'A' | 'B' (whose turn it is now)
    turn_seconds INTEGER NOT NULL DEFAULT ${DEFAULT_TURN_SECONDS},
    timer_total INTEGER NOT NULL DEFAULT ${DEFAULT_TURN_SECONDS},     -- length of the current turn
    timer_remaining INTEGER NOT NULL DEFAULT ${DEFAULT_TURN_SECONDS}, -- seconds left as of the last pause/reset
    timer_running INTEGER NOT NULL DEFAULT 0,
    timer_end_at INTEGER,          -- epoch ms when running, null when paused
    spymaster_shots INTEGER NOT NULL DEFAULT 0,
    guesser_shots INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL    -- epoch ms; here for future cleanup jobs
  )
`);

// Preset word pool that games seed from, loaded from the `words` file.
// One word per line; blanks and comments (#) are ignored.
function loadWordPool() {
  const raw = fs.readFileSync(path.join(__dirname, 'words'), 'utf8');
  const words = raw
    .split(/\r?\n/)
    .map(w => w.trim().toUpperCase())
    .filter(w => w && !w.startsWith('#'));
  const unique = [...new Set(words)];
  if (unique.length < 25) {
    throw new Error(`words file has only ${unique.length} usable words; need at least 25`);
  }
  return unique;
}

const DEFAULT_WORDS = loadWordPool();

// URL-safe random token. bytes=8 -> ~11 chars, bytes=16 -> ~22 chars.
function randomToken(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildColorSet(startingTeam) {
  // Standard 25-tile distribution: starting team gets 9, other gets 8, 7 neutral, 1 assassin
  const other = startingTeam === 'A' ? 'B' : 'A';
  const colors = [
    ...Array(9).fill(startingTeam),
    ...Array(8).fill(other),
    ...Array(7).fill('NEUTRAL'),
    'ASSASSIN'
  ];
  return shuffle(colors);
}

// Roll a fresh board: 25 words drawn from the pool, a random starting team,
// its color layout, and a normalized turn length.
function rollBoard(turnSeconds) {
  const startingTeam = Math.random() < 0.5 ? 'A' : 'B';
  return {
    words: shuffle(DEFAULT_WORDS).slice(0, 25),
    colors: buildColorSet(startingTeam),
    revealed: Array(25).fill(false),
    startingTeam,
    secs: turnSeconds && turnSeconds > 0 ? turnSeconds : DEFAULT_TURN_SECONDS
  };
}

// Create a brand-new game. Returns its public id and secret spymaster token.
function createGame(turnSeconds) {
  const id = randomToken(8);
  const spymasterToken = randomToken(16);
  const b = rollBoard(turnSeconds);
  db.prepare(`
    INSERT INTO games (
      id, spymaster_token, words, colors, revealed, starting_team,
      active_team, turn_seconds,
      timer_total, timer_remaining, timer_running, timer_end_at,
      spymaster_shots, guesser_shots, created_at
    )
    VALUES (
      @id, @token, @words, @colors, @revealed, @st,
      @st, @secs,
      @secs, @secs, 0, NULL,
      0, 0, @now
    )
  `).run({
    id,
    token: spymasterToken,
    words: JSON.stringify(b.words),
    colors: JSON.stringify(b.colors),
    revealed: JSON.stringify(b.revealed),
    st: b.startingTeam,
    secs: b.secs,
    now: Date.now()
  });
  return { id, spymasterToken };
}

// "Play again" for an existing game: re-roll the board (fresh words from the
// pool + new colors, timers/shots cleared) while keeping the same links and
// turn length. Authorized by the secret spymaster token. Returns the board id.
function resetGameByToken(token) {
  const row = db.prepare('SELECT id, turn_seconds FROM games WHERE spymaster_token = ?').get(token);
  if (!row) return null;
  const b = rollBoard(row.turn_seconds);
  db.prepare(`
    UPDATE games SET
      words=@words, colors=@colors, revealed=@revealed,
      starting_team=@st, active_team=@st,
      timer_total=@secs, timer_remaining=@secs, timer_running=0, timer_end_at=NULL,
      spymaster_shots=0, guesser_shots=0
    WHERE id=@id
  `).run({
    id: row.id,
    words: JSON.stringify(b.words),
    colors: JSON.stringify(b.colors),
    revealed: JSON.stringify(b.revealed),
    st: b.startingTeam,
    secs: b.secs
  });
  return row.id;
}

function rowToGame(row) {
  if (!row) return null;
  return {
    id: row.id,
    spymasterToken: row.spymaster_token,
    words: JSON.parse(row.words),
    colors: JSON.parse(row.colors),
    revealed: JSON.parse(row.revealed),
    startingTeam: row.starting_team,
    activeTeam: row.active_team,
    turnSeconds: row.turn_seconds,
    shots: { spymaster: row.spymaster_shots, guesser: row.guesser_shots },
    timer: {
      total: row.timer_total,
      remaining: row.timer_remaining,
      running: !!row.timer_running,
      endAt: row.timer_end_at
    },
    createdAt: row.created_at
  };
}

// Public lookup by board id (used by the board view + all mutations).
function getGameById(id) {
  return rowToGame(db.prepare('SELECT * FROM games WHERE id = ?').get(id));
}

// Privileged lookup by spymaster token (used by the key view + share hub).
function getGameByToken(token) {
  return rowToGame(db.prepare('SELECT * FROM games WHERE spymaster_token = ?').get(token));
}

// Advance to the next team's turn: flip A <-> B and load a fresh turn timer,
// paused and ready to Start.
function turnNext(id) {
  const game = getGameById(id);
  if (!game) return;
  const activeTeam = game.activeTeam === 'A' ? 'B' : 'A';
  const len = game.turnSeconds;
  db.prepare(`
    UPDATE games SET active_team = ?,
      timer_total = ?, timer_remaining = ?, timer_running = 0, timer_end_at = NULL
    WHERE id = ?
  `).run(activeTeam, len, len, id);
}

// Drinking mechanic: add 60s to the turn timer and tally the shot against the
// side that took it ('spymaster' or 'guesser').
function takeShot(id, side) {
  const game = getGameById(id);
  if (!game) return;
  const remaining = timerCurrentRemaining(game) + 60;
  const total = game.timer.total + 60;
  const col = side === 'spymaster' ? 'spymaster_shots' : 'guesser_shots';
  if (game.timer.running) {
    const endAt = Date.now() + remaining * 1000;
    db.prepare(`UPDATE games SET timer_total = ?, timer_remaining = ?, timer_end_at = ?, ${col} = ${col} + 1 WHERE id = ?`)
      .run(total, remaining, endAt, id);
  } else {
    db.prepare(`UPDATE games SET timer_total = ?, timer_remaining = ?, ${col} = ${col} + 1 WHERE id = ?`)
      .run(total, remaining, id);
  }
}

function setRevealed(id, index, value) {
  const game = getGameById(id);
  if (!game) return;
  game.revealed[index] = value;
  db.prepare('UPDATE games SET revealed = ? WHERE id = ?')
    .run(JSON.stringify(game.revealed), id);
}

function timerStart(id) {
  const game = getGameById(id);
  if (!game) return;
  const remaining = timerCurrentRemaining(game);
  const endAt = Date.now() + remaining * 1000;
  db.prepare('UPDATE games SET timer_running = 1, timer_end_at = ?, timer_remaining = ? WHERE id = ?')
    .run(endAt, remaining, id);
}

function timerPause(id) {
  const game = getGameById(id);
  if (!game) return;
  const remaining = timerCurrentRemaining(game);
  db.prepare('UPDATE games SET timer_running = 0, timer_end_at = NULL, timer_remaining = ? WHERE id = ?')
    .run(remaining, id);
}

// Reset the clock to the full turn length.
function timerReset(id) {
  const game = getGameById(id);
  if (!game) return;
  const total = game.turnSeconds;
  db.prepare('UPDATE games SET timer_total = ?, timer_remaining = ?, timer_running = 0, timer_end_at = NULL WHERE id = ?')
    .run(total, total, id);
}

// Computes the live remaining seconds for a game, whether running or paused
function timerCurrentRemaining(game) {
  if (!game.timer.running) return game.timer.remaining;
  const msLeft = game.timer.endAt - Date.now();
  return Math.max(0, Math.ceil(msLeft / 1000));
}

module.exports = {
  createGame,
  resetGameByToken,
  getGameById,
  getGameByToken,
  setRevealed,
  turnNext,
  takeShot,
  timerStart,
  timerPause,
  timerReset,
  timerCurrentRemaining,
  DEFAULT_TURN_SECONDS
};
