const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "public");
const port = process.env.PORT || 3000;
const API_BASE = "https://v3.football.api-sports.io";
const API_KEY = process.env.API_FOOTBALL_KEY;
const CACHE_TTL_MS = Math.max(60, Number(process.env.API_CACHE_SECONDS || 900)) * 1000;
const cache = new Map();

const CLUB_LEAGUES = new Set([39, 140, 135, 78, 61, 71]);
const INTERNATIONAL_REGIONS = new Set([
  "World", "Europe", "South America", "Africa", "Asia",
  "North America", "Central America", "Oceania"
]);
const NATIONAL_COMPETITION = /world cup|world cup - qualification|euro|nations league|copa america|africa cup|asian cup|gold cup|olympic|friendlies|international friendly|qualifiers/i;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

function send(res, status, data, extra = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra
  });
  res.end(JSON.stringify(data));
}

function isNationalTeamCompetition(league) {
  const country = league?.country || "";
  const name = league?.name || "";
  return INTERNATIONAL_REGIONS.has(country) ||
    (NATIONAL_COMPETITION.test(name) && league?.type !== "League");
}

async function getMatches(date) {
  const cached = cache.get(date);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.value, cached: true, updatedAt: new Date(cached.at).toISOString() };
  }

  if (!API_KEY) {
    const error = new Error("API_FOOTBALL_KEY não configurada no Render.");
    error.status = 503;
    throw error;
  }

  const url = new URL(API_BASE + "/fixtures");
  url.searchParams.set("date", date);
  url.searchParams.set("timezone", "America/Sao_Paulo");

  const response = await fetch(url, {
    headers: { "x-apisports-key": API_KEY },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    const error = new Error("O provedor esportivo respondeu HTTP " + response.status + ".");
    error.status = response.status === 429 ? 503 : 502;
    throw error;
  }

  const payload = await response.json();
  if (payload.errors && Object.keys(payload.errors).length) {
    const error = new Error("A API esportiva retornou um erro de consulta.");
    error.status = 502;
    throw error;
  }

  const all = Array.isArray(payload.response) ? payload.response : [];
  const matches = all.filter(item => {
    const leagueId = item.league?.id;
    return CLUB_LEAGUES.has(leagueId) || isNationalTeamCompetition(item.league);
  }).map(item => ({
    id: item.fixture?.id,
    date: item.fixture?.date,
    timestamp: item.fixture?.timestamp,
    status: {
      short: item.fixture?.status?.short || "TBD",
      long: item.fixture?.status?.long || "A definir",
      elapsed: item.fixture?.status?.elapsed ?? null
    },
    venue: item.fixture?.venue?.name || "",
    league: {
      id: item.league?.id,
      name: item.league?.name || "Competição",
      country: item.league?.country || "",
      logo: item.league?.logo || "",
      flag: item.league?.flag || ""
    },
    home: {
      id: item.teams?.home?.id,
      name: item.teams?.home?.name || "Mandante",
      logo: item.teams?.home?.logo || ""
    },
    away: {
      id: item.teams?.away?.id,
      name: item.teams?.away?.name || "Visitante",
      logo: item.teams?.away?.logo || ""
    },
    goals: {
      home: item.goals?.home ?? null,
      away: item.goals?.away ?? null
    },
    score: {
      halftime: item.score?.halftime || null,
      fulltime: item.score?.fulltime || null
    },
    category: CLUB_LEAGUES.has(item.league?.id)
      ? (item.league?.id === 71 ? "brasileirao" : "europa")
      : "selecoes"
  }));

  matches.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const value = { date, matches, total: matches.length, source: "API-FOOTBALL" };
  cache.set(date, { at: Date.now(), value });
  return { ...value, cached: false, updatedAt: new Date().toISOString() };
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400);
    return res.end("Requisição inválida");
  }

  if (pathname === "/api/health") {
    return send(res, 200, { ok: true, providerConfigured: Boolean(API_KEY) });
  }

  if (pathname === "/api/matches") {
    const date = new URL(req.url, "http://localhost").searchParams.get("date") ||
      new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return send(res, 400, { error: "Data inválida. Use AAAA-MM-DD." });
    }
    try {
      return send(res, 200, await getMatches(date));
    } catch (error) {
      console.error("[sports-api]", error.message);
      return send(res, error.status || 502, {
        error: error.status === 503 && !API_KEY
          ? "Dados reais ainda não ativados. Configure API_FOOTBALL_KEY nas variáveis de ambiente do Render."
          : "Não foi possível consultar os jogos agora. Tente novamente mais tarde."
      });
    }
  }

  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.resolve(root, requested);
  if (!file.startsWith(root + path.sep) && file !== path.join(root, "index.html")) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Página não encontrada");
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    res.end(data);
  });
});

server.listen(port, "0.0.0.0", () => console.log("EsporteBet sports center listening on " + port));
