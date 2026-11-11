(() => {
'use strict';
const $ = id => document.getElementById(id);
const Q = window.COMEX_QUESTIONS || [];
const qById = Object.fromEntries(Q.map(q=>[q.id,q]));
const teacherMode = new URLSearchParams(location.search).has('professor');
const cfg = window.COMEX_FIREBASE_CONFIG || {};
const adminEmail = String(window.COMEX_PROFESSOR_EMAIL||'').toLowerCase();
const joinUrl = location.origin + location.pathname + '?entrar=1';
let auth,db,uid='',user=null,config=null,players={},scores={},allAnswers={},rounds={};
let myAnswer=null,myAnswerRef=null,serverOffset=0,privateKey=null;
let timerExpired=false,scoreTimer=null,answerWatchStarted=false,playerWatchStarted=false;
let teacherListenersStarted=false,studentListenersStarted=false;
const $show=(id,visible)=>$(id).classList.toggle('hidden',!visible);
const serverNow=()=>Date.now()+serverOffset;
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const errMsg=e=> e?.message || String(e);
function toast(s){const t=$('toast');t.textContent=s;$show('toast',true);clearTimeout(window.__toast);window.__toast=setTimeout(()=>$show('toast',false),4500);}
function fmt(n){return Number(n||0).toLocaleString('pt-BR');}
function hash(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function shuffle(list,seed){const a=[...list];let s=seed||1;const next=()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};for(let i=a.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function ranking(){return Object.entries(players).map(([id,p])=>({id,name:p.nickname||'Participante',...(scores[id]||{points:0,correct:0,totalAnswered:0,totalMs:0})})).sort((a,b)=>(b.points||0)-(a.points||0)||(b.correct||0)-(a.correct||0)||(a.totalMs||0)-(b.totalMs||0)||a.name.localeCompare(b.name,'pt-BR'));}
function renderRank(target,highlight){const list=ranking();$(target).innerHTML=list.length?list.slice(0,30).map((p,i)=>`<div class="rankitem ${highlight===p.id?'me':''}"><div class="place">${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</div><div class="rankname">${escapeHtml(p.name)}</div><div class="points">${fmt(p.points)} pts</div></div>`).join(''):'<div class="empty">O ranking aparecerá quando os alunos entrarem.</div>';return list;}
function syncRank(){renderRank('studentRank',uid);renderRank('teacherRank');$('playerCount').textContent=Object.keys(players).length+' participantes cadastrados';}
function currentQuestion(){return config?.questionId ? qById[config.questionId] : null;}
function setConnection(s){$('connection').textContent=s;}
function init(){
  if(!cfg.apiKey||cfg.apiKey==='COLE_AQUI'||!cfg.databaseURL||cfg.databaseURL.includes('SEU-BANCO')){
    $show('setupView',true);setConnection('Configuração pendente');return;
  }
  if(!window.firebase){$show('setupView',true);$('setupView').querySelector('p').textContent='Não foi possível carregar o Firebase. Verifique a conexão com a internet.';return;}
  firebase.initializeApp(cfg);
  auth=firebase.auth();db=firebase.database();
  db.ref('.info/connected').on('value',s=>setConnection(s.val()?'● Online':'○ Reconectando'));
  db.ref('.info/serverTimeOffset').on('value',s=>serverOffset=s.val()||0);
  $show(teacherMode?'teacherView':'studentView',true);
  $('leaveBtn').addEventListener('click',async()=>{await auth.signOut();location.reload();});
  if(teacherMode) setupTeacherButtons(); else setupStudentButtons();
  auth.onAuthStateChanged(async u=>{
    user=u;uid=u?.uid||'';$show('leaveBtn',!!u);
    if(teacherMode){
      if(u && !u.isAnonymous && u.email?.toLowerCase()===adminEmail){
        $show('teacherLogin',false);$show('teacherDashboard',true);
        restorePrivateKey();startTeacherListeners();makeQr();renderTeacher();
      } else {
        $show('teacherLogin',true);$show('teacherDashboard',false);
        if(u && u.email?.toLowerCase()!==adminEmail)$('teacherLoginInfo').textContent='Conta não autorizada: '+(u.email||'usuário anônimo')+'. Saia e entre com o e-mail cadastrado.';
      }
    } else {
      if(!u){try{await auth.signInAnonymously();}catch(e){toast('Ative o login anônimo no Firebase: '+errMsg(e));}return;}
      startStudentListeners();
    }
  });
}
function setupStudentButtons(){
  $('joinBtn').addEventListener('click',joinGame);
  $('nickname').addEventListener('keydown',e=>{if(e.key==='Enter')joinGame();});
}
async function joinGame(){
  if(!uid||!config||config.status!=='lobby'){toast('Aguarde o professor abrir a sala.');return;}
  const nickname=$('nickname').value.trim().replace(/\s+/g,' ');
  if(nickname.length<2||nickname.length>28){toast('Use um apelido de 2 a 28 caracteres.');return;}
  $('joinBtn').disabled=true;
  try{
    await db.ref('game/players/'+uid).set({nickname,gameId:config.gameId,joinedAt:firebase.database.ServerValue.TIMESTAMP});
    toast('Você entrou! Aguarde o início.');
  }catch(e){toast('Não foi possível entrar: '+errMsg(e));}
  finally{$('joinBtn').disabled=false;}
}
function startStudentListeners(){
  if(studentListenersStarted)return;studentListenersStarted=true;
  db.ref('game/config').on('value',s=>{
    const prev=config?.questionId;config=s.val();
    if(prev!==config?.questionId){myAnswer=null;timerExpired=false;watchOwnAnswer();}
    renderStudent();
  },e=>toast('Erro ao ler sala: '+errMsg(e)));
  db.ref('game/players').on('value',s=>{players=s.val()||{};renderStudent();syncRank();});
  db.ref('game/scores').on('value',s=>{scores=s.val()||{};renderStudent();syncRank();});
  setInterval(updateTimer,250);
}
function watchOwnAnswer(){
  if(myAnswerRef){myAnswerRef.off();myAnswerRef=null;}
  if(!config?.questionId||!uid)return;
  myAnswerRef=db.ref('game/answers/'+config.questionId+'/'+uid);
  myAnswerRef.on('value',s=>{myAnswer=s.val();renderStudent();});
}
function renderStudent(){
  if(!config){$show('joinCard',true);$show('studentGame',false);$('joinInfo').textContent='O professor ainda não abriu a sala.';return;}
  const p=players[uid],joined=p&&p.gameId===config.gameId;
  $show('joinCard',!joined);$show('studentGame',!!joined);
  if(!joined){
    $('joinInfo').textContent=config.status==='lobby'?'Sala aberta! Escolha um apelido para entrar.':'O jogo já começou. Aguarde a próxima rodada ou peça ao professor para abrir uma nova sala.';
    $('joinBtn').disabled=config.status!=='lobby';return;
  }
  const place=ranking().findIndex(x=>x.id===uid)+1;
  const score=scores[uid]?.points||0;
  const info=`<div class="qmeta"><span>${escapeHtml(p.nickname)}</span><span>${fmt(score)} pontos · ${place||'—'}º lugar</span></div>`;
  if(config.status==='lobby'){
    $('studentMain').innerHTML=info+`<h2 class="bigstate">Você está no jogo! 🎉</h2><p>Aguarde o professor clicar em <strong>Iniciar jogo</strong>.</p><div class="notice">Responda rápido e corretamente. Cada acerto vale até <strong>1.500 pontos</strong>.</div>`;return;
  }
  if(config.status==='finished'){
    $('studentMain').innerHTML=info+`<h2 class="bigstate">🏁 Fim de jogo!</h2><p>Você terminou em <strong>${place}º lugar</strong>, com <strong>${fmt(score)} pontos</strong>.</p><div class="notice">Obrigado por participar! O ranking final está ao lado.</div>`;return;
  }
  const q=currentQuestion();
  if(!q){$('studentMain').innerHTML=info+'<p>Aguardando próxima pergunta...</p>';return;}
  const left=Math.max(0,(config.roundEndsAt-serverNow())/1000);
  const showOptions=config.status==='question';
  const options=shuffle(q.options,hash(uid+'|'+q.id));
  let body=`${info}<div class="qmeta" style="margin-top:25px"><span>QUESTÃO ${Number(config.index)+1} DE ${config.total||Q.length}</span><span id="timerText" class="timertext">${showOptions?Math.ceil(left)+'s':''}</span></div><h2 class="question">${escapeHtml(q.text)}</h2>`;
  if(showOptions){
    body+=`<div class="timerbar"><div id="timerFill" class="timerfill" style="width:${Math.min(100,left/(config.durationMs/1000)*100)}%"></div></div><div class="options">`;
    options.forEach((o,i)=>{
      const selected=myAnswer?.choice===o.id;
      body+=`<button class="option ${selected?'selected':''}" data-choice="${o.id}" ${myAnswer||left<=0?'disabled':''}><span class="optionletter">${i+1}</span><span>${escapeHtml(o.text)}</span></button>`;
    });
    body+='</div>';
    if(myAnswer)body+='<div class="notice">✓ Resposta registrada! Aguarde o resultado e acompanhe sua posição no ranking.</div>';
    else if(left<=0)body+='<div class="notice warn">⏱ Tempo encerrado. Aguarde o professor.</div>';
    else body+='<p class="muted small" style="margin-top:15px">Cada pergunta tem 5 alternativas. Só é possível responder uma vez.</p>';
  } else if(config.status==='reveal'){
    body+='<div class="options">';
    options.forEach((o,i)=>{
      const correct=o.id===config.correctId,chosen=o.id===myAnswer?.choice;
      body+=`<div class="option ${correct?'correct':chosen?'wrong':''}"><span class="optionletter">${i+1}</span><span>${escapeHtml(o.text)} ${correct?'✓':''}${chosen?' • sua escolha':''}</span></div>`;
    });
    body+='</div><div class="notice">'+(myAnswer?(myAnswer.choice===config.correctId?'🎉 Você acertou!':'Você não acertou desta vez.'):'Você não respondeu a tempo.')+'</div>';
    if(config.explanation)body+=`<div class="explain">${escapeHtml(config.explanation)}</div>`;
  }
  $('studentMain').innerHTML=body;
  if(showOptions && !myAnswer && left>0){
    $('studentMain').querySelectorAll('[data-choice]').forEach(btn=>btn.addEventListener('click',()=>submitAnswer(btn.dataset.choice)));
  }
}
async function submitAnswer(choice){
  if(!config||config.status!=='question'||myAnswer||serverNow()>config.roundEndsAt)return;
  $('studentMain').querySelectorAll('[data-choice]').forEach(b=>b.disabled=true);
  try{
    await db.ref('game/answers/'+config.questionId+'/'+uid).set({choice,at:firebase.database.ServerValue.TIMESTAMP});
    myAnswer={choice};renderStudent();
  }catch(e){toast('Resposta não registrada: '+errMsg(e));renderStudent();}
}
function updateTimer(){
  if(teacherMode)return;
  if(config?.status!=='question')return;
  const left=Math.max(0,(config.roundEndsAt-serverNow())/1000);
  const el=$('timerText'),fill=$('timerFill');
  if(el)el.textContent=Math.ceil(left)+'s';
  if(fill)fill.style.width=Math.min(100,left/(config.durationMs/1000)*100)+'%';
  if(left<=0&&!timerExpired){timerExpired=true;renderStudent();}
}
function setupTeacherButtons(){
  $('googleLogin').addEventListener('click',async()=>{
    try{await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());}
    catch(e){$('teacherLoginInfo').textContent='Falha no login: '+errMsg(e)+'. Verifique o domínio autorizado no Firebase Authentication.';}
  });
  $('keyFile').addEventListener('change',loadKey);
  $('forgetKey').addEventListener('click',()=>{localStorage.removeItem('comex_teacher_key_v1');$('rememberKey').checked=false;toast('Gabarito salvo apagado. O gabarito desta sessão continua carregado.');});
  $('newGameBtn').addEventListener('click',newGame);
  $('startBtn').addEventListener('click',()=>nextQuestion(true));
  $('nextBtn').addEventListener('click',()=>nextQuestion(false));
  $('revealBtn').addEventListener('click',reveal);
  $('finishBtn').addEventListener('click',finish);
  $('copyLink').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(joinUrl);toast('Link copiado.');}catch(e){toast('Copie o link exibido abaixo do QR Code.');}});
  $('exportRank').addEventListener('click',exportRanking);
  setInterval(updateTeacherTimer,250);
}
async function loadKey(event){
  const file=event.target.files?.[0];if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(!data.answers||Q.some(q=>!q.options.some(o=>o.id===data.answers[q.id]?.correctId)))throw new Error('Gabarito incompleto ou incompatível com as 15 perguntas.');
    privateKey=data.answers;
    if($('rememberKey').checked)localStorage.setItem('comex_teacher_key_v1',JSON.stringify(data));
    else localStorage.removeItem('comex_teacher_key_v1');
    $('keyStatus').textContent='✓ Gabarito validado: '+Object.keys(privateKey).length+' respostas. Mantenha esta aba aberta.';
    toast('Gabarito carregado com sucesso.');
    scheduleScore();renderTeacher();
  }catch(e){privateKey=null;$('keyStatus').textContent='Erro: '+errMsg(e);}
}
function exportRanking(){
  const rows=[['Posição','Apelido','Pontos','Acertos','Respostas','Tempo total (ms)'],...ranking().map((p,i)=>[i+1,p.name,p.points||0,p.correct||0,p.totalAnswered||0,p.totalMs||0])];
  const csv='\uFEFF'+rows.map(row=>row.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(';')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='COMEX_QUIZ_Ranking.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function updateTeacherTimer(){
  if(!teacherMode||config?.status!=='question')return;
  const t=$('teacherTimerText');if(t)t.textContent='⏱ '+Math.max(0,Math.ceil((config.roundEndsAt-serverNow())/1000))+'s';
}
function restorePrivateKey(){
  if(privateKey)return;
  try{
    const stored=localStorage.getItem('comex_teacher_key_v1');if(!stored)return;
    const data=JSON.parse(stored);
    if(!data.answers||Q.some(q=>!q.options.some(o=>o.id===data.answers[q.id]?.correctId)))return;
    privateKey=data.answers;
    $('rememberKey').checked=true;
    $('keyStatus').textContent='✓ Gabarito recuperado deste navegador. Não compartilhe este dispositivo.';
  }catch(e){localStorage.removeItem('comex_teacher_key_v1');}
}
function makeQr(){
  const el=$('qrcode');el.innerHTML='';
  $('joinLink').href=joinUrl;$('joinLink').textContent=joinUrl;
  if(window.QRCode){new QRCode(el,{text:joinUrl,width:190,height:190,colorDark:'#07162b',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});}
  else el.innerHTML='<span style="color:#07162b">QR Code indisponível. Compartilhe o link abaixo.</span>';
}
function startTeacherListeners(){
  if(teacherListenersStarted)return;teacherListenersStarted=true;
  db.ref('game/config').on('value',s=>{config=s.val();renderTeacher();});
  db.ref('game/players').on('value',s=>{players=s.val()||{};syncRank();renderTeacher();scheduleScore();});
  db.ref('game/scores').on('value',s=>{scores=s.val()||{};syncRank();});
  db.ref('game/answers').on('value',s=>{allAnswers=s.val()||{};scheduleScore();renderTeacher();},e=>toast('Sem acesso às respostas: confira as regras. '+errMsg(e)));
  db.ref('game/rounds').on('value',s=>{rounds=s.val()||{};scheduleScore();});
}
function renderTeacher(){
  if(!teacherMode||!$('teacherDashboard')||$('teacherDashboard').classList.contains('hidden'))return;
  const status=config?.status||'não criada';
  const labels={lobby:'Sala aberta • aguardando alunos',question:'Pergunta em andamento',reveal:'Resposta revelada',finished:'Jogo encerrado'};
  $('teacherStatus').textContent=(labels[status]||'Crie uma sala para começar')+' · '+Object.keys(players).length+' participantes';
  $('startBtn').disabled=!config||status!=='lobby'||!privateKey;
  $('revealBtn').disabled=status!=='question'||!privateKey;
  $('nextBtn').disabled=status!=='reveal'||!privateKey;
  $('finishBtn').disabled=!config||status==='finished';
  if(!config){$('teacherMain').innerHTML='<h2>Comece por aqui</h2><p>1. Carregue o gabarito privado. 2. Clique em <strong>Nova sala / zerar</strong>. 3. Projete o QR Code.</p>';return;}
  if(status==='lobby'){
    $('teacherMain').innerHTML=`<div class="eyebrow">SALA ABERTA</div><h2 class="bigstate">Aguardando participantes...</h2><p><strong>${Object.keys(players).length}</strong> alunos entraram. Compartilhe o QR Code e, quando todos estiverem prontos, clique em <strong>Iniciar jogo</strong>.</p><div class="notice">15 questões · 5 opções · 20 segundos por questão · até 1.500 pontos por acerto.</div>`;
    return;
  }
  if(status==='finished'){
    $('teacherMain').innerHTML=`<div class="eyebrow">COMPETIÇÃO ENCERRADA</div><h2 class="bigstate">🏆 Parabéns à turma!</h2><p>Confira o ranking final. Para jogar novamente, clique em <strong>Nova sala / zerar</strong>.</p>`;
    return;
  }
  const q=currentQuestion();if(!q)return;
  const ans=allAnswers[q.id]||{};
  const count=Object.keys(ans).length;
  const left=Math.max(0,Math.ceil((config.roundEndsAt-serverNow())/1000));
  let body=`<div class="qmeta"><span>QUESTÃO ${Number(config.index)+1} / ${config.total}</span><span>${status==='question'?`<span id=\"teacherTimerText\">⏱ ${left}s</span>`:'RESPOSTA REVELADA'}</span></div><h2 class="question">${escapeHtml(q.text)}</h2>`;
  body+='<div class="options">'+q.options.map(o=>`<div class="option ${status==='reveal'&&o.id===config.correctId?'correct':''}"><span class="optionletter">${o.id.toUpperCase()}</span><span>${escapeHtml(o.text)}</span></div>`).join('')+'</div>';
  body+=`<div class="notice">${count} respostas recebidas de ${Object.keys(players).length} participantes.</div>`;
  if(status==='reveal')body+=`<div class="explain"><strong>Gabarito:</strong> ${escapeHtml(config.explanation||'')}</div>`;
  $('teacherMain').innerHTML=body;
}
async function newGame(){
  if(!confirm('Criar nova sala? Isso apaga os participantes, respostas e placar da sala anterior.'))return;
  try{
    const sequence=shuffle(Q.map(q=>q.id),hash(String(Date.now())+Math.random()));
    const gameId=String(Date.now())+'-'+Math.floor(Math.random()*100000);
    await db.ref('game').set({config:{status:'lobby',gameId,sequence,total:sequence.length,index:-1,questionId:'',durationMs:20000,roundStartedAt:0,roundEndsAt:0,reveal:false}});
    toast('Nova sala aberta. Projete o QR Code.');
  }catch(e){toast('Erro ao criar sala: '+errMsg(e));}
}
async function nextQuestion(fromLobby){
  if(!privateKey){toast('Carregue o gabarito privado primeiro.');return;}
  if(!config){toast('Crie uma sala primeiro.');return;}
  if(fromLobby&&config.status!=='lobby')return;
  if(!fromLobby&&config.status!=='reveal')return;
  const index=Number(config.index)+1;
  if(index>=config.sequence.length){await finish();return;}
  const id=config.sequence[index],now=serverNow(),duration=Number(config.durationMs||20000);
  const stamp=firebase.database.ServerValue.TIMESTAMP;
  try{
    await db.ref('game').update({
      'config/status':'question','config/questionId':id,'config/index':index,
      'config/roundStartedAt':stamp,'config/roundEndsAt':now+duration+500,
      'config/correctId':null,'config/explanation':null,'config/reveal':false,
      ['rounds/'+id]:{startedAt:stamp,endsAt:now+duration+500,durationMs:duration,index}
    });
    toast('Pergunta '+(index+1)+' iniciada.');
  }catch(e){toast('Erro ao iniciar pergunta: '+errMsg(e));}
}
async function reveal(){
  if(!config||config.status!=='question'||!privateKey)return;
  const k=privateKey[config.questionId];if(!k)return;
  try{await db.ref('game/config').update({status:'reveal',correctId:k.correctId,explanation:k.explanation||''});scheduleScore();}
  catch(e){toast('Erro ao revelar: '+errMsg(e));}
}
async function finish(){
  if(!config)return;
  try{await db.ref('game/config/status').set('finished');scheduleScore();toast('Jogo encerrado.');}
  catch(e){toast('Erro ao encerrar: '+errMsg(e));}
}
function scheduleScore(){
  if(!teacherMode||!privateKey||!teacherListenersStarted)return;
  clearTimeout(scoreTimer);scoreTimer=setTimeout(computeScores,300);
}
async function computeScores(){
  if(!privateKey||!user||user.email?.toLowerCase()!==adminEmail)return;
  const result={};
  for(const uid of Object.keys(players))result[uid]={points:0,correct:0,totalAnswered:0,totalMs:0};
  for(const [qid,entries] of Object.entries(allAnswers)){
    const round=rounds[qid],k=privateKey[qid];if(!round||!k)continue;
    for(const [id,a] of Object.entries(entries||{})){
      if(!result[id]||!a||!a.at)continue;
      result[id].totalAnswered++;
      const ms=Math.max(0,Math.min(Number(round.durationMs||20000),Number(a.at)-Number(round.startedAt)));
      result[id].totalMs+=ms;
      if(a.choice===k.correctId){
        result[id].correct++;
        result[id].points+=1000+Math.round(500*(1-ms/Number(round.durationMs||20000)));
      }
    }
  }
  try{await db.ref('game/scores').set(result);}catch(e){toast('Erro ao atualizar placar: '+errMsg(e));}
}
window.addEventListener('error',e=>{if(e.message?.includes('firebase'))setConnection('Erro de configuração');});
init();
})();
