function fmtTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// Per-page state, set by initBoard / initSpymaster:
//   IS_BOARD_VIEW — true = public board, false = spymaster key
//   POLL_KEY      — what /api/state|spystate is keyed by (boardId vs secret token)
//   BOARD_ID      — public board id, used for every mutation
let IS_BOARD_VIEW = true;
let POLL_KEY = '';
let BOARD_ID = '';

async function post(path, body) {
  await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  refreshState();
}

async function reveal(index) {
  // On the spymaster view, locking in a guess is deliberate and irreversible,
  // so confirm first. The public/TV board stays instant for fast play.
  if (!IS_BOARD_VIEW) {
    const tiles = document.querySelectorAll('.tile');
    const word = tiles[index] ? tiles[index].textContent.trim() : 'this tile';
    if (!confirm(`Lock in "${word}" as your team's guess? This reveals it on the board.`)) return;
  }
  post('/api/reveal', { boardId: BOARD_ID, index });
}

function timerAction(action) {
  post(`/api/timer/${action}`, { boardId: BOARD_ID });
}

function turnNext() {
  post('/api/turn/next', { boardId: BOARD_ID });
}

function takeShot(side) {
  post('/api/shot', { boardId: BOARD_ID, side });
}

// Banner text/class from live state — end state (win / assassin) or whose turn.
function bannerInfo(data) {
  const o = data.outcome;
  if (o && o.over && o.assassin) {
    return { text: '💀 ASSASSIN — GAME OVER', cls: 'phase-banner ended assassin' };
  }
  if (o && o.over) {
    return { text: `🎉 TEAM ${o.winner} WINS!`, cls: `phase-banner ended team-${o.winner.toLowerCase()}` };
  }
  return { text: `TEAM ${data.activeTeam}'S TURN`, cls: `phase-banner team-${data.activeTeam.toLowerCase()}` };
}

async function refreshState() {
  const endpoint = IS_BOARD_VIEW ? `/api/state/${POLL_KEY}` : `/api/spystate/${POLL_KEY}`;
  const res = await fetch(endpoint);
  if (!res.ok) return;
  const data = await res.json();

  const timerEl = document.getElementById('timer');
  if (timerEl) {
    timerEl.textContent = fmtTime(data.timer.remaining);
    timerEl.classList.toggle('running', data.timer.running);
    timerEl.classList.toggle('done', data.timer.remaining === 0);
  }

  // Turn / end-state banner (present on both board + spymaster views).
  const banner = document.getElementById('phase-banner');
  if (banner && data.activeTeam) {
    const info = bannerInfo(data);
    banner.textContent = info.text;
    banner.className = info.cls;
  }

  // Shot tally (present on both views).
  const tally = document.getElementById('tally');
  if (tally && data.shots) {
    tally.textContent = `🥃 Spymaster shots: ${data.shots.spymaster} · Guesser shots: ${data.shots.guesser}`;
  }

  const tiles = document.querySelectorAll('.tile');
  tiles.forEach((tile, i) => {
    const revealed = data.revealed[i];
    if (IS_BOARD_VIEW) {
      if (!revealed) return;
      const color = data.displayColors[i];
      tile.classList.add('revealed', `team-${color.toLowerCase()}`);
      tile.disabled = true;
    } else {
      // Spymaster view: colors are already rendered server-side; just dim once
      // revealed and lock the tile so it can't be re-tapped.
      tile.classList.toggle('revealed', !!revealed);
      tile.disabled = !!revealed;
    }
  });
}

// Flash any button/tile on click so a tap is visibly acknowledged, even when
// the resulting state change is subtle or a no-op. Delegated so one handler
// covers every button and tile on the page.
document.addEventListener('click', (e) => {
  const el = e.target.closest('.btn, .tile');
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth; // restart the animation on rapid repeat clicks
  el.classList.add('flash');
});
document.addEventListener('animationend', (e) => {
  if (e.animationName === 'click-flash') e.target.classList.remove('flash');
});

function initBoard(boardId) {
  IS_BOARD_VIEW = true;
  POLL_KEY = boardId;
  BOARD_ID = boardId;
  refreshState();
  setInterval(refreshState, 1000);
}

function initSpymaster(token, boardId) {
  IS_BOARD_VIEW = false;
  POLL_KEY = token;
  BOARD_ID = boardId;
  refreshState();
  setInterval(refreshState, 1000);
}
