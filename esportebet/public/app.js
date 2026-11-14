const $ = (selector) => document.querySelector(selector);
const matchesEl = $("#matches");
const messageEl = $("#message");
const dateInput = $("#matchDate");
const updatedEl = $("#updatedAt");
const state = { filter: "todos", timer: null, loading: false, selections: [] };

const todayInBrazil = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());

function shiftDate(date, amount) {
  const value = new Date(date + "T12:00:00");
  value.setDate(value.getDate() + amount);
  return [value.getFullYear(), String(value.getMonth()+1).padStart(2,"0"), String(value.getDate()).padStart(2,"0")].join("-");
}

function formatTime(value) {
  if (!value) return "Horário a definir";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

function statusLabel(status) {
  const live = ["1H","HT","2H","ET","P","LIVE","BT"];
  if (live.includes(status.short)) return status.elapsed ? status.elapsed + "'" : "AO VIVO";
  if (status.short === "FT" || status.short === "AET" || status.short === "PEN") return "Encerrado";
  if (status.short === "PST") return "Adiado";
  if (status.short === "CANC" || status.short === "ABD") return "Cancelado";
  if (status.short === "TBD") return "A definir";
  return "Agendado";
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[char]);
}

function demoOdds(match) {
  const seed = Number(match.id || 0);
  return [
    {key:"home",label:"Vitória "+match.home.name,market:"Resultado final",odd:1.65+(seed%35)/100},
    {key:"draw",label:"Empate",market:"Resultado final",odd:3.05+(seed%45)/100},
    {key:"away",label:"Vitória "+match.away.name,market:"Resultado final",odd:2.45+(seed%65)/100},
    {key:"over",label:"Mais de 1,5 gols",market:"Total de gols",odd:1.35+(seed%20)/100},
    {key:"btts",label:"Ambas marcam — Sim",market:"Ambas marcam",odd:1.75+(seed%30)/100}
  ];
}
function addSelection(match, option) {
  const id=String(match.id)+":"+option.key;
  if(state.selections.some(item=>item.id===id)) state.selections=state.selections.filter(item=>item.id!==id);
  else {
    state.selections=state.selections.filter(item=>!(item.matchId===String(match.id)&&item.market===option.market));
    state.selections.push({id,matchId:String(match.id),fixture:match.home.name+" x "+match.away.name,market:option.market,label:option.label,odd:option.odd});
  }
  renderBetSlip();
  if(window.lastMatchData) render(window.lastMatchData);
}
function matchCard(match) {
  const live = ["1H","HT","2H","ET","P","LIVE","BT"].includes(match.status.short);
  const finished = ["FT","AET","PEN"].includes(match.status.short);
  const score = match.goals.home !== null && match.goals.away !== null;
  const homeScore = score ? match.goals.home : "–";
  const awayScore = score ? match.goals.away : "–";
  const status = statusLabel(match.status);
  const badgeClass = live ? "live" : finished ? "finished" : "";
  const kickoff = live || finished ? status : formatTime(match.date);
  const homeLogo = match.home.logo ? '<img src="' + esc(match.home.logo) + '" alt="" loading="lazy">' : '<span class="team-placeholder">?</span>';
  const awayLogo = match.away.logo ? '<img src="' + esc(match.away.logo) + '" alt="" loading="lazy">' : '<span class="team-placeholder">?</span>';
  return '<article class="match-card">' +
    '<div class="match-league">' + (match.league.logo ? '<img src="' + esc(match.league.logo) + '" alt="" loading="lazy">' : '') +
    '<span>' + esc(match.league.name) + (match.league.country ? ' · ' + esc(match.league.country) : '') + '</span>' +
    '<b class="status ' + badgeClass + '">' + esc(kickoff) + '</b></div>' +
    '<div class="match-teams"><div class="team">' + homeLogo + '<strong>' + esc(match.home.name) + '</strong></div>' +
    '<div class="score"><b>' + homeScore + '</b><span>:</span><b>' + awayScore + '</b></div>' +
    '<div class="team away">' + awayLogo + '<strong>' + esc(match.away.name) + '</strong></div></div>' +
    '<div class="match-bottom"><span>' + esc(match.status.long) + '</span><span>Dados esportivos</span></div>' +
    (live || finished ? '<div class="market-disabled">Mercados indisponíveis para partidas em andamento ou encerradas nesta demonstração.</div>' :
    '<div class="demo-markets"><div class="market-title">Resultado final <small>cotações fictícias</small></div>' +
    demoOdds(match).slice(0,3).map(option=>'<button type="button" class="market-option '+(state.selections.some(item=>item.id===String(match.id)+":"+option.key)?"selected":"")+'" data-match="'+esc(match.id)+'" data-market="'+option.key+'"><span>'+esc(option.label)+'</span><b>'+option.odd.toFixed(2)+'</b></button>').join("")+
    '<div class="market-title secondary-market">Outros mercados</div>'+
    demoOdds(match).slice(3).map(option=>'<button type="button" class="market-option '+(state.selections.some(item=>item.id===String(match.id)+":"+option.key)?"selected":"")+'" data-match="'+esc(match.id)+'" data-market="'+option.key+'"><span>'+esc(option.label)+'</span><b>'+option.odd.toFixed(2)+'</b></button>').join("")+'</div>')+'</article>';
}

function renderBetSlip() {
  const stake=Math.max(0,Number($("#stake").value)||0);
  const combined=state.selections.reduce((total,item)=>total*item.odd,1);
  $("#betSelections").innerHTML=state.selections.length?state.selections.map(item=>'<article class="slip-item"><div><small>'+esc(item.fixture)+' · '+esc(item.market)+'</small><strong>'+esc(item.label)+'</strong></div><b>'+item.odd.toFixed(2)+'</b><button type="button" class="remove-selection" data-remove="'+esc(item.id)+'" aria-label="Remover seleção">×</button></article>').join(""):'<p class="empty-slip">Escolha um mercado em uma partida para começar a montar seu bilhete.</p>';
  $("#combinedOdds").textContent=state.selections.length?combined.toFixed(2):"—";
  $("#potentialReturn").textContent=state.selections.length?(stake*combined).toLocaleString("pt-BR",{style:"currency",currency:"BRL"}):"R$ 0,00";
  $("#simulateBet").disabled=!state.selections.length||stake<1||stake>10000;
  $("#betFeedback").textContent=state.selections.length?(state.selections.length>1?"Bilhete múltiplo":"Bilhete simples")+" de demonstração · "+state.selections.length+" seleção(ões).":"As cotações são fictícias e servem apenas para demonstrar o funcionamento do bilhete.";
}
function render(data) {
  window.lastMatchData=data;
  const list = data.matches.filter(match => state.filter === "todos" || match.category === state.filter);
  matchesEl.innerHTML = list.map(matchCard).join("");
  messageEl.classList.remove("error");
  messageEl.textContent = list.length ? list.length + (list.length === 1 ? " partida encontrada." : " partidas encontradas.") : "Nenhuma partida encontrada para este filtro nesta data.";
  updatedEl.textContent = "Dados consultados às " + new Intl.DateTimeFormat("pt-BR", { hour:"2-digit", minute:"2-digit", second:"2-digit", timeZone:"America/Sao_Paulo" }).format(new Date(data.updatedAt)) + (data.cached ? " · cache" : " · API");
}

async function loadMatches(force = false) {
  if (state.loading) return;
  state.loading = true;
  if (force) messageEl.textContent = "Atualizando partidas…";
  try {
    const response = await fetch("/api/matches?date=" + encodeURIComponent(dateInput.value) + (force ? "&refresh=1" : ""), { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao carregar partidas.");
    render(data);
  } catch (error) {
    matchesEl.innerHTML = "";
    messageEl.classList.add("error");
    messageEl.textContent = error.message;
    updatedEl.textContent = "Dados indisponíveis";
  } finally {
    state.loading = false;
  }
}

document.addEventListener("click",event=>{
  const market=event.target.closest("[data-match][data-market]");
  if(market&&window.lastMatchData){const match=window.lastMatchData.matches.find(item=>String(item.id)===market.dataset.match);const option=match&&demoOdds(match).find(item=>item.key===market.dataset.market);if(match&&option)addSelection(match,option);}
  const remove=event.target.closest("[data-remove]");
  if(remove){state.selections=state.selections.filter(item=>item.id!==remove.dataset.remove);renderBetSlip();if(window.lastMatchData)render(window.lastMatchData);}
});
$("#stake").addEventListener("input",renderBetSlip);
$("#clearBet").addEventListener("click",()=>{state.selections=[];renderBetSlip();if(window.lastMatchData)render(window.lastMatchData);});
$("#simulateBet").addEventListener("click",async()=>{
  const stake=Number($("#stake").value),odds=state.selections.reduce((total,item)=>total*item.odd,1);
  if(!accountUser){openAccount("login");$("#accountFeedback").textContent="Entre ou crie uma conta para salvar este bilhete no seu histórico.";return;}
  const button=$("#simulateBet");button.disabled=true;button.textContent="Salvando…";
  try{
    const response=await fetch("/api/bets",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({stake,combinedOdds:odds,selections:state.selections})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||"Não foi possível salvar o bilhete.");
    $("#betFeedback").textContent="Simulação salva no seu histórico. Nenhuma aposta real foi realizada.";
    await loadBetHistory();
  }catch(error){$("#betFeedback").textContent=error.message;}
  finally{button.textContent="Simular";renderBetSlip();}
});

let accountUser=null, accountMode="login";
function openAccount(mode="login"){accountMode=mode;$("#accountModal").hidden=false;setAccountMode(mode);$("#accountEmail").focus();}
function closeAccount(){$("#accountModal").hidden=true;}
function setAccountMode(mode){
  accountMode=mode;
  document.querySelectorAll("[data-account-mode]").forEach(button=>button.classList.toggle("active",button.dataset.accountMode===mode));
  const registering=mode==="register";
  $("#nameLabel").hidden=!registering;$("#accountFullName").hidden=!registering;$("#accountFullName").required=registering;
  $("#accountPassword").autocomplete=registering?"new-password":"current-password";
  $("#accountTitle").textContent=registering?"Criar sua conta":"Acesse sua conta";
  $("#accountSubmit").textContent=registering?"Cadastrar":"Entrar";
  $("#accountFeedback").textContent="";
}
async function loadBetHistory(){
  if(!accountUser){$("#betHistory").innerHTML='<p class="history-empty">Entre na sua conta para consultar seus bilhetes demonstrativos.</p>';return;}
  try{
    const response=await fetch("/api/bets",{credentials:"same-origin",cache:"no-store"}),data=await response.json();
    if(!response.ok)throw new Error(data.error||"Falha ao carregar histórico.");
    $("#betHistory").innerHTML=data.bets.length?data.bets.map(bet=>{
      const date=new Date(bet.created_at).toLocaleString("pt-BR");
      const selections=Array.isArray(bet.selections)?bet.selections:[];
      return '<article class="history-item"><div class="history-meta"><b>Bilhete #'+esc(bet.id)+'</b><time>'+esc(date)+'</time></div>'+selections.map(item=>'<p>'+esc(item.fixture)+' · '+esc(item.label)+' <b>'+Number(item.odd).toFixed(2)+'</b></p>').join("")+'<div class="history-total"><span>Valor fictício: '+Number(bet.stake).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})+'</span><b>Retorno ilustrativo: '+Number(bet.potential_return).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})+'</b></div></article>';
    }).join(""):'<p class="history-empty">Você ainda não salvou nenhum bilhete demonstrativo.</p>';
  }catch(error){$("#betHistory").innerHTML='<p class="history-empty">'+esc(error.message)+'</p>';}
}
function setAccount(user){
  accountUser=user;
  $("#accountButton").textContent=user?"Minha conta":"Entrar";
  $("#accountName").hidden=!user;$("#accountName").textContent=user?user.name:"";
  $("#logoutButton").hidden=!user;
  loadBetHistory();
}
document.querySelectorAll("[data-account-mode]").forEach(button=>button.addEventListener("click",()=>setAccountMode(button.dataset.accountMode)));
$("#accountButton").addEventListener("click",()=>{if(accountUser){$("#historySection").scrollIntoView({behavior:"smooth"});loadBetHistory();}else openAccount("login");});
$("#closeAccount").addEventListener("click",closeAccount);
$("#accountModal").addEventListener("click",event=>{if(event.target===$("#accountModal"))closeAccount();});
$("#accountForm").addEventListener("submit",async event=>{
  event.preventDefault();const button=$("#accountSubmit");button.disabled=true;button.textContent="Aguarde…";
  const payload={email:$("#accountEmail").value.trim(),password:$("#accountPassword").value};
  if(accountMode==="register")payload.name=$("#accountFullName").value.trim();
  try{
    const response=await fetch("/api/auth/"+(accountMode==="register"?"register":"login"),{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify(payload)});
    const data=await response.json();if(!response.ok)throw new Error(data.error||"Não foi possível autenticar.");
    setAccount(data.user);closeAccount();$("#accountForm").reset();
  }catch(error){$("#accountFeedback").textContent=error.message;}
  finally{button.disabled=false;button.textContent=accountMode==="register"?"Cadastrar":"Entrar";}
});
$("#logoutButton").addEventListener("click",async()=>{
  await fetch("/api/auth/logout",{method:"POST",credentials:"same-origin"});setAccount(null);$("#accountFeedback").textContent="Você saiu da sua conta.";
});
$("#historyRefresh").addEventListener("click",loadBetHistory);
fetch("/api/auth/me",{credentials:"same-origin",cache:"no-store"}).then(response=>response.json()).then(data=>setAccount(data.user||null)).catch(()=>setAccount(null));

renderBetSlip();
dateInput.value = todayInBrazil();
dateInput.addEventListener("change", () => loadMatches(true));
$("#prevDay").addEventListener("click", () => { dateInput.value = shiftDate(dateInput.value, -1); loadMatches(true); });
$("#nextDay").addEventListener("click", () => { dateInput.value = shiftDate(dateInput.value, 1); loadMatches(true); });
$("#todayButton").addEventListener("click", () => { dateInput.value = todayInBrazil(); loadMatches(true); });
$("#refreshButton").addEventListener("click", () => loadMatches(true));
document.querySelectorAll(".filter").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll(".filter").forEach(item => item.classList.remove("active"));
  button.classList.add("active");
  state.filter = button.dataset.filter;
  loadMatches();
}));

loadMatches();
state.timer = setInterval(() => loadMatches(), 60000);
