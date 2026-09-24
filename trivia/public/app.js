'use strict';
const app=document.querySelector('#app'), error=document.querySelector('#error'), connection=document.querySelector('#connection');
const id=location.pathname.match(/^\/g\/([a-f0-9]{16})$/)?.[1];
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=null,busy=false,last='',polling=false;
let playerView=new URLSearchParams(location.search).get('view')==='player';
const playerLink=location.origin+'/g/'+id+'?view=player';
async function api(url,body) {
  const response=await fetch(url,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok) throw new Error(result.error||'Request failed.');
  return result;
}
function showError(e){error.textContent=e.message||String(e);}
function download(pack){const url=URL.createObjectURL(new Blob([JSON.stringify(pack,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='quiz-questions.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function setup(){
  app.innerHTML='<div class="setup-page"><form id="join" class="join"><label for="code">Join a game</label><div class="actions"><input id="code" name="code" placeholder="Game code" required maxlength="16" pattern="[a-fA-F0-9]{16}" autocomplete="off"><button>Join</button></div></form><form id="setup" class="setup"><h2>Create a game</h2><label for="title">Game title</label><input id="title" name="title" value="Rahul’s Bachelor Party" maxlength="100" required><label for="teams">Teams · one per line</label><textarea id="teams" name="teams" required>Team One\nTeam Two\nTeam Three</textarea><p class="help">Choose 2–8 teams. Teams select in the order listed.</p><label for="password">Host password</label><input id="password" name="password" type="password" minlength="8" maxlength="128" required autocomplete="new-password"><p class="help">Use this to sign in as host.</p><label for="pack">Question pack · JSON file</label><input id="pack" type="file" accept=".json,application/json"><p id="pack-status" class="help">Using the starter pack: Berkeley, San Francisco, Random, Cupertino, and Wildcard.</p><button type="button" id="template">Download question template</button><details><summary>Question file format</summary><p class="help">Five categories, each with a name and five clues. Each clue needs question, answer, points, and special. Mark exactly two clues special.</p><pre>[{\n  "name": "Category name",\n  "clues": [{\n    "question": "Your question?",\n    "answer": "Accepted answer",\n    "points": 200,\n    "special": false\n  }]\n}]</pre><p class="help">Download the complete template above. For a photo or video, add media with type (image or video), url (a direct HTTPS file link), and optional alt text. Video links should point to files such as MP4, not YouTube or Drive pages.</p></details><label><input id="party" type="checkbox" checked>Enable team-shot questions</label><label for="shots">Shot questions</label><input id="shots" type="number" min="1" max="23" value="4" required><p class="help">Random questions, excluding Double or Nothing. Any beverage is fine; joining in is optional.</p><button class="primary" id="create">Create game</button><p class="help">Progress saves automatically.</p></form></div>';
  let template=await api('/api/template');
  document.querySelector('#template').onclick=()=>download(template);
  document.querySelector('#party').onchange=e=>document.querySelector('#shots').disabled=!e.target.checked;
  document.querySelector('#pack').onchange=e=>document.querySelector('#pack-status').textContent=e.target.files[0]?'Selected: '+e.target.files[0].name:'Using the starter pack.';
  document.querySelector('#join').onsubmit=e=>{e.preventDefault();location.href='/g/'+new FormData(e.target).get('code').toLowerCase();};
  document.querySelector('#setup').onsubmit=async e=>{
    e.preventDefault();error.textContent='';const btn=document.querySelector('#create');btn.disabled=true;
    try {
      const data=new FormData(e.target),file=document.querySelector('#pack').files[0];
      if(file && file.size>90000) throw new Error('Keep the question file under 90 KB.');
      let categories=template;
      if(file){try{categories=JSON.parse(await file.text());}catch{throw new Error('The file is not valid JSON. Check commas and quotation marks.');}}
      const result=await api('/api/games',{title:data.get('title'),teams:data.get('teams').split('\n').map(s=>s.trim()).filter(Boolean),password:data.get('password'),categories,shotCount:document.querySelector('#party').checked?Number(document.querySelector('#shots').value):0});
      location.href='/g/'+result.id;
    }catch(e){showError(e);btn.disabled=false;}
  };
}
function button(label,action,extra=''){return '<button data-action="'+action+'" '+extra+'>'+label+'</button>';}
function questionMedia(media) {
  if (!media) return '';
  const url=esc(media.url), alt=esc(media.alt || (media.type==='image'?'Question photo':'Question video'));
  const content=media.type==='image'
    ? '<img data-question-media src="'+url+'" alt="'+alt+'" referrerpolicy="no-referrer">'
    : '<video data-question-media src="'+url+'" controls playsinline preload="metadata" aria-label="'+alt+'">Your browser cannot play this video.</video>';
  return '<div class="question-media">'+content+'<p class="media-error help" hidden>Could not load this '+(media.type==='image'?'photo':'video')+'. <a href="'+url+'" target="_blank" rel="noopener noreferrer">Open it separately</a></p></div>';
}
function draw(){
  const optionsOpen=!!document.querySelector('.game-options')?.open;
  const s=state,a=s.active,finished=s.used.length===25,who=s.teams[s.turn].name;
  document.title=s.title+' · Quiz Night';
  let html='<section class="topline"><div><h1 class="game-name">'+esc(s.title)+'</h1><span class="muted">'+s.used.length+' / 25</span></div><details class="game-options"><summary>Options</summary><div class="actions"><button id="share">Show QR code</button>'+(s.host?button('Undo','undo',s.canUndo?'':'disabled')+'<button id="logout">Sign out</button>':'<button id="unlock">Host sign in</button>')+'</div><p class="share">Game code: '+id+'</p><a class="share" href="/g/'+id+'?view=player">'+esc(playerLink)+'</a></details></section>';
  if(finished){
    const top=Math.max(...s.teams.map(t=>t.score)), winners=s.teams.filter(t=>t.score===top).map(t=>t.name);
    html+='<section class="win"><h2>'+esc(winners.join(' & '))+(winners.length>1?' tie!':' wins!')+'</h2><p>'+top.toLocaleString()+' points</p><a href="/" class="button primary">Create another game</a></section>';
  }else{
    let status=a?(a.phase==='steal'?(a.stealing===null?'Open for a steal':s.teams[a.stealing].name+' is answering'):a.phase==='resolved'?'Answer revealed':who+' is answering'):who+' selects';
    html+='<div class="status"><strong>'+esc(status)+'</strong></div>';
  }
  if(a){
    html+='<section class="clue"><p class="eyebrow">'+esc(a.category)+' · '+a.points.toLocaleString()+' points'+(a.multiplier===2?' · double stakes':'')+'</p>';
    if(a.phase==='shot'){
      html+='<h2>Team shot!</h2><p class="answer">'+esc(who)+'</p><p class="muted">Take a shot together, choose any beverage, or sit this one out.</p>'+(s.host?button('Continue','continue','class="primary"'):'<p>Waiting for the host to open the question.</p>');
    }else if(a.phase==='wager'){
      html+='<h2>Double or Nothing</h2><p>'+esc(who)+', choose your stakes before seeing the question.</p><p class="muted">Normal: win '+a.points+' or lose nothing.<br>Double: win '+(a.points*2)+' or lose '+(a.points*2)+'. No steals.</p>'+(s.host?'<div class="actions">'+button('Normal stakes','wager','data-multiplier="1"')+button('Double or Nothing','wager','data-multiplier="2" class="primary"')+'</div>':'<p>Waiting for the team’s choice.</p>');
    }else{
      html+='<h2>'+esc(a.question)+'</h2>'+questionMedia(a.media);
      if(a.phase==='resolved') html+='<p class="answer">'+esc(a.answer)+'</p><p>'+esc(a.result)+'</p>'+(s.host?button(s.used.length===24?'Finish game':'Next question','next','class="primary"'):'<p class="muted">Waiting for the host to continue.</p>');
      else{
        if(s.host) html+='<details class="answer-toggle"><summary>Reveal answer</summary><p class="answer">'+esc(a.answer)+'</p></details>';
        if(a.phase==='steal' && a.stealing===null){
          html+='<p>'+(s.host?'Who’s stealing?':'One chance to steal.')+'</p>';
          if(s.host) html+='<div class="actions">'+s.teams.map((t,i)=>i===s.turn?'':button(esc(t.name),'steal','data-team="'+i+'"')).join('')+button('Nobody','pass')+'</div>';
        }else if(s.host){
          html+='<div class="actions">'+button('Correct','correct','class="primary"')+button('Miss','miss')+'</div>';
        }
      }
    }
    html+='</section>';
  }else{
    html+='<section class="board" aria-label="Question board">'+s.categories.map(c=>'<div class="category">'+esc(c.name)+'</div>').join('');
    for(let row=0;row<5;row++) for(const c of s.categories){const q=c.clues[row];html+='<button class="tile '+(q.used?'used':s.host&&!finished?'available':'')+'" data-action="select" data-clue="'+q.id+'" aria-label="'+esc(c.name+', '+q.points+' points'+(q.used?', completed':''))+'" '+(!s.host||q.used||finished?'disabled':'')+'>'+(q.used?'—':q.points.toLocaleString())+'</button>';}
    html+='</section>';
  }
  html+='<section class="teams" aria-label="Scores">'+s.teams.map((t,i)=>'<div class="team '+(i===s.turn&&!finished?'current':'')+'"><strong>'+esc(t.name)+'</strong><div class="score">'+t.score.toLocaleString()+'</div><small>'+(i===s.turn&&!finished?'Selecting team':'Points')+'</small></div>').join('')+'</section>';
  app.innerHTML=html;
  app.querySelectorAll('[data-question-media]').forEach(media=>{
    const failed=()=>{ media.hidden=true; media.parentElement.querySelector('.media-error').hidden=false; };
    media.addEventListener('error',failed,{once:true});
    if(media.tagName==='IMG' && media.complete && media.naturalWidth===0) failed();
  });
  document.querySelector('.game-options').open=optionsOpen;
  document.querySelector('#share').onclick=()=>{
    const img=document.querySelector('#join-qr');
    document.querySelector('#qr-error').hidden=true;
    img.hidden=false;
    img.onerror=()=>{img.hidden=true;document.querySelector('#qr-error').hidden=false;};
    img.src='/api/games/'+id+'/qr';
    const link=document.querySelector('#player-link');
    link.href=playerLink;link.textContent=playerLink;
    document.querySelector('#copy').textContent='Copy link';
    document.querySelector('#share-dialog').showModal();
  };
  document.querySelector('#copy').onclick=async()=>{try{await navigator.clipboard.writeText(playerLink);document.querySelector('#copy').textContent='Link copied';}catch{showError(new Error('Copy the game link in Options.'));}};
  document.querySelector('#unlock')?.addEventListener('click',()=>{document.querySelector('#login-error').textContent='';document.querySelector('#login').showModal();document.querySelector('#host-password').focus();});
  document.querySelector('#logout')?.addEventListener('click',async()=>{try{await api('/api/games/'+id+'/logout',{});last='';await refresh();}catch(e){showError(e);}});
  app.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',async()=>{
    if(busy)return;busy=true;error.textContent='';
    app.querySelectorAll('[data-action]').forEach(x=>x.disabled=true);
    try{
      const data={action:b.dataset.action,version:s.version};
      if(b.dataset.clue)data.clue=b.dataset.clue;
      if(b.dataset.team!==undefined)data.team=Number(b.dataset.team);
      if(b.dataset.multiplier)data.multiplier=Number(b.dataset.multiplier);
      state=await api('/api/games/'+id+'/action',data);last=JSON.stringify(state);
    }catch(e){showError(e);last='';}finally{busy=false;draw();await refresh();}
  }));
}
async function refresh(){
  if(polling||busy)return;polling=true;
  try{
    const result=await api('/api/games/'+id+(playerView?'?view=player':''));
    connection.textContent='Connected';
    const signature=JSON.stringify(result);
    if(signature!==last){state=result;last=signature;draw();}
  }catch(e){connection.textContent='Disconnected · retrying';if(!state)showError(e);}
  finally{polling=false;}
}
document.querySelector('#close-share').onclick=()=>document.querySelector('#share-dialog').close();
document.querySelector('#cancel-login').onclick=()=>document.querySelector('#login').close();
document.querySelector('#login-form').onsubmit=async e=>{
  e.preventDefault();const b=e.target.querySelector('.primary');b.disabled=true;
  try{await api('/api/games/'+id+'/login',{password:new FormData(e.target).get('password')});playerView=false;history.replaceState(null,'','/g/'+id);e.target.reset();document.querySelector('#login').close();last='';await refresh();}
  catch(e){document.querySelector('#login-error').textContent=e.message;}finally{b.disabled=false;}
};
if(id){refresh();setInterval(refresh,1500);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});}
else setup().catch(showError);
