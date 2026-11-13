const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
    ? { rejectUnauthorized: false } : false
});

app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin: (process.env.FRONTEND_URL || "https://nasso-hosting-site.onrender.com").split(",").map(v => v.trim()),
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "30kb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(190) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hosting_services (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(120) NOT NULL,
      game VARCHAR(40) NOT NULL DEFAULT 'MTA',
      slots INTEGER NOT NULL CHECK (slots > 0),
      price_cents INTEGER NOT NULL DEFAULT 0,
      due_date DATE,
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','expired')),
      panel_url TEXT,
      ptero_identifier VARCHAR(100),
      ptero_server_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS hosting_services_user_id_idx ON hosting_services(user_id);
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hosting_id BIGINT REFERENCES hosting_services(id) ON DELETE SET NULL,
      amount_cents INTEGER NOT NULL,
      description VARCHAR(200) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject VARCHAR(160) NOT NULL,
      message TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const email = process.env.ADMIN_EMAIL.toLowerCase().trim();
    const existing = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
    if (!existing.rowCount) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
      await pool.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin')",
        ["Administrador Nasso", email, hash]
      );
      console.log("Conta administrativa inicial criada.");
    }
  }
}

function sign(user) {
  return jwt.sign({ id: String(user.id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "12h" });
}
async function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
  try {
    if (!token) throw new Error("missing");
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    const current = await pool.query("SELECT id,role,status FROM users WHERE id=$1", [claims.id]);
    if (!current.rowCount || current.rows[0].status !== "active") return res.status(403).json({ error: "Conta bloqueada ou indisponivel." });
    req.auth = { id: String(current.rows[0].id), role: current.rows[0].role };
    next();
  } catch { res.status(401).json({ error: "Sessao invalida. Entre novamente." }); }
}
function admin(req, res, next) {
  if (req.auth.role !== "admin") return res.status(403).json({ error: "Acesso administrativo necessario." });
  next();
}
function cleanUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role, status: row.status };
}

app.get("/api/health", async (_req, res) => {
  try { await pool.query("SELECT 1"); res.json({ ok: true, service: "nasso-api" }); }
  catch { res.status(503).json({ ok: false }); }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (name.length < 2 || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 100)
      return res.status(400).json({ error: "Informe nome, e-mail valido e senha com pelo menos 8 caracteres." });
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email,role,status",
      [name, email, hash]
    );
    const user = result.rows[0];
    res.status(201).json({ token: sign(user), user: cleanUser(user) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Este e-mail ja esta cadastrado." });
    console.error(e); res.status(500).json({ error: "Nao foi possivel criar a conta." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    const user = result.rows[0];
    if (!user || user.status !== "active" || !(await bcrypt.compare(String(req.body.password || ""), user.password_hash)))
      return res.status(401).json({ error: "E-mail ou senha incorretos, ou conta bloqueada." });
    res.json({ token: sign(user), user: cleanUser(user) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Falha ao entrar." }); }
});

app.get("/api/me", auth, async (req, res) => {
  const r = await pool.query("SELECT id,name,email,role,status FROM users WHERE id=$1", [req.auth.id]);
  if (!r.rowCount || r.rows[0].status !== "active") return res.status(403).json({ error: "Conta indisponivel." });
  res.json({ user: cleanUser(r.rows[0]) });
});

app.get("/api/hostings", auth, async (req, res) => {
  const r = await pool.query(
    "SELECT id,title,game,slots,price_cents,due_date,status,panel_url,ptero_identifier,created_at FROM hosting_services WHERE user_id=$1 ORDER BY created_at DESC",
    [req.auth.id]
  );
  res.json({ hostings: r.rows });
});

app.get("/api/payments", auth, async (req, res) => {
  const r = await pool.query(
    "SELECT id,hosting_id,amount_cents,description,status,paid_at,created_at FROM payments WHERE user_id=$1 ORDER BY created_at DESC",
    [req.auth.id]
  );
  res.json({ payments: r.rows });
});

app.get("/api/tickets", auth, async (req, res) => {
  const r = await pool.query("SELECT id,subject,message,status,created_at FROM tickets WHERE user_id=$1 ORDER BY created_at DESC", [req.auth.id]);
  res.json({ tickets: r.rows });
});
app.post("/api/tickets", auth, async (req, res) => {
  const subject = String(req.body.subject || "").trim();
  const message = String(req.body.message || "").trim();
  if (subject.length < 4 || subject.length > 160 || message.length < 10 || message.length > 4000)
    return res.status(400).json({ error: "Assunto ou mensagem fora do tamanho permitido." });
  const r = await pool.query("INSERT INTO tickets(user_id,subject,message) VALUES($1,$2,$3) RETURNING id,subject,message,status,created_at", [req.auth.id, subject, message]);
  res.status(201).json({ ticket: r.rows[0] });
});

async function pteroRequest(path, options = {}) {
  if (!process.env.PTERODACTYL_URL || !process.env.PTERODACTYL_CLIENT_API_KEY)
    throw new Error("PTERODACTYL_NOT_CONFIGURED");
  const base = process.env.PTERODACTYL_URL.replace(/\/+$/, "");
  const response = await fetch(base + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + process.env.PTERODACTYL_CLIENT_API_KEY,
      Accept: "Application/vnd.pterodactyl.v1+json",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error("PTERODACTYL_HTTP_" + response.status);
  return response.status === 204 ? null : response.json();
}
app.post("/api/hostings/:id/power", auth, async (req, res) => {
  const signal = String(req.body.signal || "");
  if (!["start","stop","restart"].includes(signal)) return res.status(400).json({ error: "Acao invalida." });
  const r = await pool.query(
    "SELECT id,ptero_identifier,status FROM hosting_services WHERE id=$1 AND user_id=$2",
    [req.params.id, req.auth.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: "Hospedagem nao encontrada." });
  const hosting = r.rows[0];
  if (hosting.status !== "active") return res.status(403).json({ error: "Hospedagem suspensa ou vencida." });
  if (!hosting.ptero_identifier) return res.status(409).json({ error: "Esta hospedagem ainda nao esta vinculada ao Pterodactyl." });
  try {
    await pteroRequest("/api/client/servers/" + encodeURIComponent(hosting.ptero_identifier) + "/power", {
      method: "POST", body: JSON.stringify({ signal })
    });
    res.json({ ok: true, message: "Comando enviado ao Pterodactyl." });
  } catch (e) {
    if (e.message === "PTERODACTYL_NOT_CONFIGURED") return res.status(503).json({ error: "Integracao Pterodactyl ainda nao configurada." });
    console.error(e); res.status(502).json({ error: "O painel nao aceitou o comando. Verifique a chave de API e as permissoes." });
  }
});

// Rotas administrativas: sempre filtradas/validadas no servidor.
app.get("/api/admin/users", auth, admin, async (_req, res) => {
  const r = await pool.query("SELECT id,name,email,role,status,created_at FROM users ORDER BY created_at DESC");
  res.json({ users: r.rows });
});
app.post("/api/admin/users", auth, admin, async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8)
    return res.status(400).json({ error: "Dados invalidos. A senha deve ter pelo menos 8 caracteres." });
  try {
    const hash = await bcrypt.hash(password, 12);
    const r = await pool.query("INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email,status", [name,email,hash]);
    res.status(201).json({ user: r.rows[0] });
  } catch (e) { if (e.code === "23505") return res.status(409).json({ error: "E-mail ja cadastrado." }); console.error(e); res.status(500).json({ error: "Falha ao cadastrar cliente." }); }
});
app.patch("/api/admin/users/:id/status", auth, admin, async (req, res) => {
  const status = req.body.status;
  if (!["active","blocked"].includes(status)) return res.status(400).json({ error: "Status invalido." });
  const r = await pool.query("UPDATE users SET status=$1 WHERE id=$2 AND role='customer' RETURNING id,name,email,status", [status,req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: "Cliente nao encontrado." });
  res.json({ user: r.rows[0] });
});
app.get("/api/admin/hostings", auth, admin, async (_req, res) => {
  const r = await pool.query("SELECT h.id,h.user_id,h.title,h.game,h.slots,h.price_cents,h.due_date,h.status,h.ptero_identifier,u.name AS customer_name,u.email FROM hosting_services h JOIN users u ON u.id=h.user_id ORDER BY h.created_at DESC");
  res.json({ hostings: r.rows });
});
app.post("/api/admin/hostings", auth, admin, async (req, res) => {
  const userId = Number(req.body.user_id), slots = Number(req.body.slots), price = Number(req.body.price_cents || 0);
  const title = String(req.body.title || "").trim(), game = String(req.body.game || "MTA").trim();
  const dueDate = req.body.due_date || null, panelUrl = req.body.panel_url ? String(req.body.panel_url).trim() : null;
  const identifier = req.body.ptero_identifier ? String(req.body.ptero_identifier).trim() : null;
  if (!Number.isInteger(userId) || !Number.isInteger(slots) || slots < 1 || slots > 100000 || !title || title.length > 120 || !["MTA","SA-MP","FiveM","Minecraft","Outro"].includes(game) || !Number.isInteger(price) || price < 0)
    return res.status(400).json({ error: "Dados da hospedagem invalidos." });
  const owner = await pool.query("SELECT id FROM users WHERE id=$1 AND role='customer'", [userId]);
  if (!owner.rowCount) return res.status(404).json({ error: "Cliente nao encontrado." });
  const r = await pool.query(
    "INSERT INTO hosting_services(user_id,title,game,slots,price_cents,due_date,panel_url,ptero_identifier) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
    [userId,title,game,slots,price,dueDate,panelUrl,identifier]
  );
  res.status(201).json({ hosting: r.rows[0] });
});
app.patch("/api/admin/hostings/:id", auth, admin, async (req, res) => {
  const allowed = ["active","suspended","expired"];
  const status = req.body.status;
  const dueDate = req.body.due_date;
  if (status && !allowed.includes(status)) return res.status(400).json({ error: "Status invalido." });
  const r = await pool.query(
    "UPDATE hosting_services SET status=COALESCE($1,status), due_date=COALESCE($2,due_date) WHERE id=$3 RETURNING *",
    [status || null,dueDate || null,req.params.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: "Hospedagem nao encontrada." });
  res.json({ hosting: r.rows[0] });
});
app.post("/api/admin/payments", auth, admin, async (req, res) => {
  const userId = Number(req.body.user_id), amount = Number(req.body.amount_cents), hostingId = req.body.hosting_id || null;
  const description = String(req.body.description || "").trim(), status = req.body.status || "pending";
  if (!Number.isInteger(userId) || !Number.isInteger(amount) || amount < 0 || !description || description.length > 200 || !["pending","paid","cancelled"].includes(status))
    return res.status(400).json({ error: "Dados de pagamento invalidos." });
  const r = await pool.query(
    "INSERT INTO payments(user_id,hosting_id,amount_cents,description,status,paid_at) VALUES($1,$2,$3,$4,$5,CASE WHEN $5='paid' THEN NOW() END) RETURNING *",
    [userId,hostingId,amount,description,status]
  );
  res.status(201).json({ payment: r.rows[0] });
});
app.get("/api/admin/tickets", auth, admin, async (_req, res) => {
  const r = await pool.query("SELECT t.id,t.subject,t.message,t.status,t.created_at,u.name AS customer_name,u.email FROM tickets t JOIN users u ON u.id=t.user_id ORDER BY t.created_at DESC");
  res.json({ tickets: r.rows });
});
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: "Erro interno." }); });

initDb().then(() => app.listen(PORT, () => console.log("Nasso API online na porta " + PORT)))
  .catch(err => { console.error("Falha ao iniciar banco:", err); process.exit(1); });
