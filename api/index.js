// Vercel serverless entry — teruskan semua request ke handler Node polos di server.js.
// Tanpa framework, tanpa build step. Env (DATABASE_URL, AUTH_SECRET, ...) diisi
// via Vercel Dashboard → Project → Settings → Environment Variables.
const { handleRequest } = require("../server.js");

module.exports = (req, res) => handleRequest(req, res);
