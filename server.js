const express = require('express');
const QRCode = require('qrcode');
const Database = require('better-sqlite3');
const { randomBytes, scryptSync, timingSafeEqual, createHash } = require('node:crypto');
const { mkdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const model = require('./trivia/game');
const dir = process.env.TRIVIA_DATA_DIR || (process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(__dirname, 'data'));
mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'trivia.db'));
db.pragma('journal_mode = WAL');
db.exec('CREATE TABLE IF NOT EXISTS trivia_games (id TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL, state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS trivia_sessions (token_hash TEXT PRIMARY KEY, game_id TEXT NOT NULL, expires INTEGER NOT NULL);');
db.prepare('DELETE FROM trivia_sessions WHERE expires < ?').run(Date.now());
const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req,res,next) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; media-src 'self' https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
  if (req.method === 'POST' && req.get('origin') && req.get('origin') !== (req.protocol + '://' + req.get('host'))) return res.status(403).json({ error: 'Request origin not allowed.' });
  next();
});
const attempts = new Map();
setInterval(() => { for (const [k,v] of attempts) if (v.until < Date.now()) attempts.delete(k); db.prepare('DELETE FROM trivia_sessions WHERE expires < ?').run(Date.now()); }, 60000).unref();
function limit(req,res,next) {
  const key = req.ip;
  let entry = attempts.get(key);
  if (!entry || entry.until < Date.now()) {
    if (attempts.size > 10000) return res.status(429).json({ error: 'Please try again later.' });
    entry = { count: 0, until: Date.now()+600000 }; attempts.set(key,entry);
  }
  if (++entry.count > 20) return res.status(429).json({ error: 'Too many attempts. Try again in ten minutes.' });
  next();
}
const digest = t => createHash('sha256').update(t).digest('hex');
function password(p) { if (typeof p !== 'string' || p.length < 8 || p.length > 128) throw new Error('Choose a host password with 8–128 characters.'); return p; }
function session(req, id) {
  const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('trivia_session='));
  if (!cookie) return false;
  return !!db.prepare('SELECT 1 FROM trivia_sessions WHERE token_hash=? AND game_id=? AND expires>?').get(digest(cookie.slice(15)),id,Date.now());
}
function grant(req,res,id) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO trivia_sessions VALUES (?,?,?)').run(digest(token),id,Date.now()+7*86400000);
  res.cookie('trivia_session',token,{ httpOnly:true, secure:req.secure, sameSite:'strict', maxAge:7*86400000, path:'/' });
}
function load(req,res,next) {
  const row = db.prepare('SELECT * FROM trivia_games WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error:'Game not found. Check the game link or code.' });
  req.gameRow=row; req.game=JSON.parse(row.state); req.isHost=session(req,row.id); next();
}
function host(req,res,next) { if (!req.isHost) return res.status(401).json({error:'Sign in as host to control this game.'}); next(); }
app.get('/health', (req,res) => res.json({ok:true,app:'quiz-night'}));
app.get('/api/template', (req,res) => res.json(JSON.parse(readFileSync(path.join(__dirname,'trivia/questions.json'),'utf8'))));
app.post('/api/games',limit,(req,res) => {
  const input=req.body;
  const p=password(input.password);
  const g=model.create(input), id=randomBytes(8).toString('hex'), salt=randomBytes(16).toString('hex');
  db.prepare('INSERT INTO trivia_games VALUES (?,?,?,?)').run(id,salt,scryptSync(p,salt,64).toString('hex'),JSON.stringify(g));
  grant(req,res,id); res.status(201).json({id});
});
app.get('/api/games/:id',load,(req,res) => res.json(model.view(req.game,req.isHost && req.query.view !== 'player')));
app.get('/api/games/:id/qr',load,(req,res,next) => {
  const origin = (process.env.BASE_URL || req.protocol + '://' + req.get('host')).replace(/\/$/, '');
  QRCode.toBuffer(origin + '/g/' + req.params.id + '?view=player', { width: 360, margin: 4, errorCorrectionLevel: 'M' })
    .then(buffer => res.type('png').send(buffer)).catch(next);
});
app.post('/api/games/:id/login',limit,load,(req,res) => {
  const p=password(req.body.password);
  if (!timingSafeEqual(scryptSync(p,req.gameRow.salt,64),Buffer.from(req.gameRow.password_hash,'hex'))) return res.status(401).json({error:'Incorrect host password.'});
  grant(req,res,req.params.id); res.json({ok:true});
});
app.post('/api/games/:id/logout',load,(req,res) => {
  const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('trivia_session='));
  if(cookie) db.prepare('DELETE FROM trivia_sessions WHERE token_hash=?').run(digest(cookie.slice(15)));
  res.clearCookie('trivia_session',{path:'/'}); res.json({ok:true});
});
app.get('/api/games/:id/pack',load,host,(req,res)=>res.json(req.game.categories));
app.post('/api/games/:id/action',load,host,(req,res) => {
  if (req.body.version !== req.game.version) return res.status(409).json({error:'Another host action changed the game. Try again.'});
  const g=model.action(req.game,req.body);
  db.prepare('UPDATE trivia_games SET state=? WHERE id=?').run(JSON.stringify(g),req.params.id);
  res.json(model.view(g,true));
});
app.use('/assets',express.static(path.join(__dirname,'trivia/public'),{index:false}));
app.get(['/', '/g/:id'],(req,res)=>res.sendFile(path.join(__dirname,'trivia/public/index.html')));
app.use((req,res)=>res.status(404).json({error:'Not found.'}));
app.use((err,req,res,next)=>{ if (err.code && err.code.startsWith('SQLITE')) { console.error(err); return res.status(500).json({error:'Could not save the game. Please try again.'}); } res.status(err.status || 400).json({error:err.message || 'Could not complete that request.'}); });
const server=app.listen(Number(process.env.PORT||3000),process.env.BIND_HOST||'127.0.0.1',()=>console.log('Quiz Night listening on '+server.address().port));
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0);}));
