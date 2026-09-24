const { randomInt } = require('node:crypto');
function check(ok, message) { if (!ok) throw new Error(message); }
function text(v, max = 100) { check(typeof v === 'string' && v.trim().length > 0 && v.length <= max, 'Please check text fields and their lengths.'); return v.trim(); }
function validatePack(input) {
  check(Array.isArray(input) && input.length === 5, 'The pack needs exactly five categories.');
  const pack = input.map(c => {
    check(c && Array.isArray(c.clues) && c.clues.length === 5, 'Each category needs five questions.');
    return { name: text(c.name, 60), clues: c.clues.map(q => {
      check(q && Number.isInteger(q.points) && q.points > 0 && q.points <= 10000, 'Points must be whole numbers from 1 to 10,000.');
      check(typeof q.special === 'boolean', 'Each question needs special: true or false.');
      return { question: text(q.question, 1500), answer: text(q.answer, 1000), points: q.points, special: q.special };
    }) };
  });
  check(pack.flatMap(c => c.clues).filter(q => q.special).length === 2, 'Mark exactly two questions as special.');
  return pack;
}
function create(input) {
  check(Array.isArray(input.teams) && input.teams.length >= 2 && input.teams.length <= 8, 'Enter between two and eight teams.');
  const teams = input.teams.map(name => ({ name: text(name, 40), score: 0 }));
  check(new Set(teams.map(t => t.name.toLowerCase())).size === teams.length, 'Give each team a different name.');
  const categories = validatePack(input.categories);
  const shotCount = input.shotCount;
  check(Number.isInteger(shotCount) && shotCount >= 0 && shotCount <= 23, 'Choose zero to 23 shot questions.');
  const eligible = categories.flatMap((c, x) => c.clues.map((q,y) => q.special ? null : x + '-' + y)).filter(Boolean);
  for (let i = eligible.length - 1; i > 0; i--) { const j = randomInt(i + 1); [eligible[i], eligible[j]] = [eligible[j], eligible[i]]; }
  return { title: text(input.title, 100), categories, teams, shotCount, shots: eligible.slice(0, shotCount), used: [], turn: 0, active: null, history: [], version: 0 };
}
function clue(g, id) { check(typeof id === 'string' && /^[0-4]-[0-4]$/.test(id), 'Invalid question.'); return g.categories[Number(id[0])].clues[Number(id[2])]; }
function action(g, b) {
  check(b.version === g.version, 'The game changed. Refresh and try again.');
  if (b.action === 'undo') {
    check(g.history.length > 0, 'Nothing to undo.');
    Object.assign(g, g.history.pop()); g.version++; return g;
  }
  const before = structuredClone({ teams: g.teams, used: g.used, turn: g.turn, active: g.active });
  const a = g.active;
  if (b.action === 'select') {
    check(!a && g.used.length < 25 && !g.used.includes(b.clue), 'Choose an available question.');
    const q = clue(g, b.clue);
    g.active = { id: b.clue, phase: q.special ? 'wager' : g.shots.includes(b.clue) ? 'shot' : 'question', multiplier: 1, stealing: null, result: '' };
  } else if (b.action === 'continue') {
    check(a && a.phase === 'shot', 'No team-shot prompt is open.'); a.phase = 'question';
  } else if (b.action === 'wager') {
    check(a && a.phase === 'wager' && [1,2].includes(b.multiplier), 'Choose normal or double stakes.');
    a.multiplier = b.multiplier; a.phase = 'question';
  } else if (b.action === 'steal') {
    check(a && a.phase === 'steal' && a.stealing === null, 'Stealing is not available.');
    check(Number.isInteger(b.team) && g.teams[b.team] && b.team !== g.turn, 'Choose a different team.');
    a.stealing = b.team;
  } else if (b.action === 'correct' || b.action === 'miss') {
    check(a && (a.phase === 'question' || (a.phase === 'steal' && a.stealing !== null)), 'Choose the answering team first.');
    const q = clue(g, a.id);
    const who = a.phase === 'steal' ? a.stealing : g.turn;
    const amount = q.points * a.multiplier;
    if (b.action === 'correct') {
      g.teams[who].score += amount; a.result = g.teams[who].name + ' earns ' + amount + ' points.'; a.phase = 'resolved';
    } else if (q.special) {
      if (a.multiplier === 2) g.teams[who].score -= amount;
      a.result = a.multiplier === 2 ? g.teams[who].name + ' loses ' + amount + ' points.' : 'No points awarded.';
      a.phase = 'resolved';
    } else if (a.phase === 'steal') { a.result = 'No points awarded.'; a.phase = 'resolved';
    } else { a.phase = 'steal'; }
  } else if (b.action === 'pass') {
    check(a && a.phase === 'steal', 'Mark the selecting team’s answer first.'); a.phase = 'resolved'; a.result = 'No points awarded.';
  } else if (b.action === 'next') {
    check(a && a.phase === 'resolved', 'Finish judging this question first.');
    g.used.push(a.id); g.active = null; g.turn = (g.turn + 1) % g.teams.length;
  } else { throw new Error('Unknown action.'); }
  g.history.push(before); if (g.history.length > 100) g.history.shift();
  g.version++; return g;
}
function view(g, host = false) {
  let active = null;
  if (g.active) {
    const a = g.active, q = clue(g, a.id);
    active = { ...a, category: g.categories[Number(a.id[0])].name, points: q.points, special: q.special, shot: g.shots.includes(a.id) };
    if (!['shot','wager'].includes(a.phase)) {
      active.question = q.question;
      if (host || a.phase === 'resolved') active.answer = q.answer;
    }
  }
  return { title: g.title, teams: g.teams, shotCount: g.shotCount, turn: g.turn, active, used: g.used, version: g.version,
    host, canUndo: host && g.history.length > 0,
    categories: g.categories.map((c,x) => ({ name: c.name, clues: c.clues.map((q,y) => ({ id: x+'-'+y, points: q.points, used: g.used.includes(x+'-'+y) })) }))
  };
}
module.exports = { create, action, view, validatePack };
