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
$("#simulateBet").addEventListener("click",()=>{
  const stake=Number($("#stake").value),odds=state.selections.reduce((total,item)=>total*item.odd,1);
  alert("SIMULAÇÃO ESPORTEBET\\n"+state.selections.map(item=>item.fixture+" — "+item.label+" ("+item.odd.toFixed(2)+")").join("\\n")+"\\nValor fictício: "+stake.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})+"\\nOdd combinada: "+odds.toFixed(2)+"\\nRetorno ilustrativo: "+(stake*odds).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})+"\\n\\nNenhuma aposta ou transação real foi realizada.");
});
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
