const $ = (selector) => document.querySelector(selector);
const matchesEl = $("#matches");
const messageEl = $("#message");
const dateInput = $("#matchDate");
const updatedEl = $("#updatedAt");
const state = { filter: "todos", timer: null, loading: false };

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
    '<div class="match-bottom"><span>' + esc(match.status.long) + '</span><span>Dados esportivos</span></div></article>';
}

function render(data) {
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
