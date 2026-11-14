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


const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { Pool } = require("pg");
const scrypt = promisify(crypto.scrypt);
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
}) : null;
let schemaReady;
async function ensureSchema() {
  if (!pool) throw new Error("Banco de dados não configurado.");
  if (!schemaReady) schemaReady = pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash CHAR(64) PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS demo_bets (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stake NUMERIC(12,2) NOT NULL CHECK (stake >= 1 AND stake <= 10000),
      combined_odds NUMERIC(12,4) NOT NULL,
      potential_return NUMERIC(14,2) NOT NULL,
      selections JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS demo_bets_user_created_idx ON demo_bets(user_id, created_at DESC);
  `).catch(error => { schemaReady = null; throw error; });
  await schemaReady;
}
function sendJson(res, status, data, extra = {}) {
  res.writeHead(status, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", ...extra });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; if (raw.length > 20000) { reject(new Error("Corpo muito grande.")); req.destroy(); } });
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { reject(new Error("JSON inválido.")); } });
    req.on("error", reject);
  });
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf("="); return [v.slice(0,i), decodeURIComponent(v.slice(i+1))];
  }));
}
function cookieHeader(token, maxAge) {
  return "esportebet_session=" + encodeURIComponent(token) + "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=" + maxAge;
}
async function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = await scrypt(password, salt, 64);
  return salt + ":" + derived.toString("hex");
}
async function passwordMatches(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}
const hashToken = token => crypto.createHash("sha256").update(token).digest("hex");
async function currentUser(req) {
  await ensureSchema();
  const token = cookies(req).esportebet_session;
  if (!token || token.length > 200) return null;
  const result = await pool.query(
    "SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()",
    [hashToken(token)]
  );
  return result.rows[0] || null;
}
async function handleAccount(req, res, pathname) {
  try {
    await ensureSchema();
    if (req.method === "POST" && pathname === "/api/auth/register") {
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (name.length < 2 || name.length > 80) return sendJson(res,400,{error:"Informe um nome entre 2 e 80 caracteres."});
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return sendJson(res,400,{error:"E-mail inválido."});
      if (password.length < 10 || password.length > 128) return sendJson(res,400,{error:"A senha deve ter entre 10 e 128 caracteres."});
      const hashed = await passwordHash(password);
      const created = await pool.query("INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email",[name,email,hashed]);
      const token = crypto.randomBytes(32).toString("hex");
      await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '7 days')",[hashToken(token),created.rows[0].id]);
      return sendJson(res,201,{user:created.rows[0]}, {"Set-Cookie":cookieHeader(token,604800)});
    }
    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const result = await pool.query("SELECT id,name,email,password_hash FROM users WHERE email=$1",[email]);
      if (!result.rows[0] || !(await passwordMatches(String(body.password || ""),result.rows[0].password_hash))) return sendJson(res,401,{error:"E-mail ou senha incorretos."});
      const user = {id:result.rows[0].id,name:result.rows[0].name,email:result.rows[0].email};
      const token = crypto.randomBytes(32).toString("hex");
      await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '7 days')",[hashToken(token),user.id]);
      return sendJson(res,200,{user},{"Set-Cookie":cookieHeader(token,604800)});
    }
    if (req.method === "POST" && pathname === "/api/auth/logout") {
      const token = cookies(req).esportebet_session;
      if (token) await pool.query("DELETE FROM sessions WHERE token_hash=$1",[hashToken(token)]);
      return sendJson(res,200,{ok:true},{"Set-Cookie":cookieHeader("",0)});
    }
    if (req.method === "GET" && pathname === "/api/auth/me") {
      const user = await currentUser(req);
      return sendJson(res,200,{user});
    }
    const user = await currentUser(req);
    if (!user) return sendJson(res,401,{error:"Faça login para acessar seu histórico."});
    if (req.method === "GET" && pathname === "/api/bets") {
      const rows = await pool.query("SELECT id,stake,combined_odds,potential_return,selections,created_at FROM demo_bets WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",[user.id]);
      return sendJson(res,200,{bets:rows.rows});
    }
    if (req.method === "POST" && pathname === "/api/bets") {
      const body = await readBody(req);
      const stake = Number(body.stake);
      const odds = Number(body.combinedOdds);
      const selections = body.selections;
      if (!Number.isFinite(stake) || stake < 1 || stake > 10000 || !Number.isFinite(odds) || odds < 1 || odds > 100000 || !Array.isArray(selections) || selections.length < 1 || selections.length > 20) return sendJson(res,400,{error:"Bilhete demonstrativo inválido."});
      const safeSelections = selections.map(item => ({
        fixture:String(item.fixture || "").slice(0,160),
        market:String(item.market || "").slice(0,80),
        label:String(item.label || "").slice(0,160),
        odd:Number(item.odd)
      }));
      if (safeSelections.some(item => !Number.isFinite(item.odd) || item.odd < 1 || item.odd > 1000 || !item.fixture || !item.label)) return sendJson(res,400,{error:"Uma ou mais seleções são inválidas."});
      const potentialReturn = Number((stake * odds).toFixed(2));
      const saved = await pool.query("INSERT INTO demo_bets(user_id,stake,combined_odds,potential_return,selections) VALUES($1,$2,$3,$4,$5) RETURNING id,stake,combined_odds,potential_return,selections,created_at",[user.id,stake,odds,potentialReturn,JSON.stringify(safeSelections)]);
      return sendJson(res,201,{bet:saved.rows[0]});
    }
    return sendJson(res,404,{error:"Rota não encontrada."});
  } catch (error) {
    if (error.code === "23505") return sendJson(res,409,{error:"Este e-mail já está cadastrado."});
    console.error("[account-api]",error.message);
    return sendJson(res,503,{error:"Serviço de conta temporariamente indisponível."});
  }
}
const server = http.createServer(async (req, res) => {
  const accountPath = new URL(req.url, "http://localhost").pathname;
  if (accountPath.startsWith("/api/auth/") || accountPath === "/api/bets") return handleAccount(req, res, accountPath);
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
