const { app, initDb } = require("../server");

let databaseReady;

module.exports = async function handler(req, res) {
  try {
    databaseReady ||= initDb();
    await databaseReady;

    // Vercel pode encaminhar o catch-all com ou sem o prefixo /api.
    const requestUrl = req.url || "/";
    if (requestUrl !== "/api" && !requestUrl.startsWith("/api/")) {
      req.url = "/api" + (requestUrl.startsWith("/") ? requestUrl : "/" + requestUrl);
    }

    return app(req, res);
  } catch (error) {
    console.error("Falha ao inicializar a API Nasso:", error);
    return res.status(503).json({ error: "API temporariamente indisponível." });
  }
};
