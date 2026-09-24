const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const model=require('./game'), template=require('./questions.json');
const make=(shotCount=4)=>model.create({title:'Test night',teams:['A','B','C'],categories:template,shotCount});
const act=(g,action,rest={})=>model.action(g,{version:g.version,action,...rest});
function open(g,id){act(g,'select',{clue:id});if(g.active.phase==='shot')act(g,'continue');}
test('validates question packs and configurable teams',()=>{
 assert.throws(()=>model.create({title:'X',teams:['same','same'],categories:template,shotCount:4}),/different/);
 assert.throws(()=>model.validatePack(template.slice(1)),/five/);
 const p=structuredClone(template);p[0].clues[3].special=false;assert.throws(()=>model.validatePack(p),/exactly two/);
 assert.equal(make().teams.length,3);assert.throws(()=>make(24),/23/);
});
test('shot questions are unique, random, and exclude specials',()=>{
 const sets=new Set();
 for(let i=0;i<40;i++){const g=make();assert.equal(g.shots.length,4);assert.equal(new Set(g.shots).size,4);assert.ok(!g.shots.includes('0-3'));assert.ok(!g.shots.includes('3-2'));sets.add([...g.shots].sort().join(','));}
 assert.ok(sets.size>1);assert.deepEqual(make(0).shots,[]);
});
test('public state hides future content, specials, shots and answers',()=>{
 const g=make(),v=model.view(g);assert.equal(v.shots,undefined);assert.equal(v.categories[0].clues[3].special,undefined);assert.equal(v.categories[0].clues[0].question,undefined);
 open(g,'0-0');assert.equal(model.view(g).active.answer,undefined);assert.equal(model.view(g,true).active.answer,'Oski');act(g,'correct');assert.equal(model.view(g).active.answer,'Oski');
});
test('shot prompt precedes question and survives undo',()=>{
 const g=make();act(g,'select',{clue:g.shots[0]});assert.equal(g.active.phase,'shot');assert.equal(model.view(g,true).active.question,undefined);
 act(g,'continue');assert.equal(g.active.phase,'question');act(g,'undo');assert.equal(g.active.phase,'shot');
});
test('one steal and fixed turn rotation; undo restores score and turn',()=>{
 const g=make(0);open(g,'0-0');act(g,'miss');assert.equal(g.active.phase,'steal');assert.throws(()=>act(g,'steal',{team:0}),/different/);
 act(g,'steal',{team:2});act(g,'correct');assert.equal(g.teams[2].score,200);assert.throws(()=>act(g,'correct'),/answering/);
 act(g,'next');assert.equal(g.turn,1);assert.deepEqual(g.used,['0-0']);act(g,'undo');assert.equal(g.turn,0);act(g,'undo');assert.equal(g.teams[2].score,0);assert.equal(g.active.phase,'steal');
});
test('missed steal awards zero and ends the question',()=>{
 const g=make(0);open(g,'0-0');act(g,'miss');act(g,'steal',{team:1});act(g,'miss');assert.equal(g.active.phase,'resolved');assert.ok(g.teams.every(t=>t.score===0));assert.throws(()=>act(g,'steal',{team:2}),/not available/);
});
test('special hides clue before choice, double stakes win or lose double',()=>{
 const g=make(0);act(g,'select',{clue:'0-3'});assert.equal(model.view(g,true).active.question,undefined);assert.throws(()=>act(g,'correct'),/answering/);
 act(g,'wager',{multiplier:2});act(g,'miss');assert.equal(g.teams[0].score,-1600);assert.equal(g.active.phase,'resolved');act(g,'undo');act(g,'correct');assert.equal(g.teams[0].score,1600);
 const n=make(0);act(n,'select',{clue:'0-3'});act(n,'wager',{multiplier:1});act(n,'miss');assert.equal(n.teams[0].score,0);assert.equal(n.active.phase,'resolved');
});
test('stale commands cannot double award',()=>{
 const g=make(0);open(g,'0-0');const version=g.version;act(g,'correct');assert.throws(()=>model.action(g,{action:'correct',version}),/changed/);assert.equal(g.teams[0].score,200);
});
test('all 25 questions complete with correct total scores',()=>{
 const g=make();for(let x=0;x<5;x++)for(let y=0;y<5;y++){open(g,x+'-'+y);if(g.active.phase==='wager')act(g,'wager',{multiplier:1});act(g,'correct');act(g,'next');}
 assert.equal(g.used.length,25);assert.equal(g.active,null);assert.equal(g.teams.reduce((n,t)=>n+t.score,0),15000);assert.throws(()=>act(g,'select',{clue:'0-0'}),/available/);
});
test('HTTP auth, privacy, CSRF and restart persistence',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'quiz-test-'));let child;
 async function start(){
  child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,TRIVIA_DATA_DIR:dir,PORT:'0',BIND_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',c=>errors+=c);
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(errors||'Startup timeout')),10000);child.stdout.on('data',c=>{const m=String(c).match(/listening on (\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});child.once('exit',code=>{clearTimeout(timer);reject(new Error('Exit '+code+errors));});});
 }
 async function stop(){const ended=once(child,'exit');child.kill('SIGTERM');await ended;}
 try{
  let base=await start();
  async function req(route,body,cookie){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,json:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0],headers:r.headers};}
  const created=await req('/api/games',{title:'Private night',teams:['One','Two'],categories:template,password:'a-long-test-password',shotCount:4});
  assert.equal(created.status,201);assert.ok(created.headers.get('set-cookie').includes('HttpOnly'));
  const route='/api/games/'+created.json.id,cookie=created.cookie;
  assert.equal((await req(route)).json.host,false);assert.equal((await req(route,undefined,cookie)).json.host,true);
  assert.equal((await req(route+'/action',{action:'select',clue:'0-0',version:0})).status,401);assert.equal((await req(route+'/pack')).status,401);
  let state=(await req(route+'/action',{action:'select',clue:'0-0',version:0},cookie)).json;
  if(state.active.phase==='shot')state=(await req(route+'/action',{action:'continue',version:state.version},cookie)).json;
  assert.equal((await req(route)).json.active.answer,undefined);
  state=(await req(route+'/action',{action:'correct',version:state.version},cookie)).json;assert.equal(state.teams[0].score,200);
  assert.equal((await req(route)).json.active.answer,'Oski');assert.equal((await req(route+'/login',{password:'wrong-password'})).status,401);
  await stop();base=await start();assert.equal((await req(route)).json.teams[0].score,200);assert.equal((await req(route,undefined,cookie)).json.host,true);
  await req(route+'/logout',{},cookie);assert.equal((await req(route,undefined,cookie)).json.host,false);assert.equal((await req(route+'/login',{password:'a-long-test-password'})).status,200);
  const csrf=await fetch(base+'/api/games',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:'{}'});assert.equal(csrf.status,403);
  assert.equal((await fetch(base+'/assets/app.js')).status,200);assert.equal((await fetch(base+'/g/'+created.json.id)).status,200);
 }finally{if(child?.exitCode===null)await stop();rmSync(dir,{recursive:true,force:true});}
});
