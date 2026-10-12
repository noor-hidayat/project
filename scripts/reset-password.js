// Reset password user (default: admin) ke nilai dari argumen CLI.
// Pakai:  node scripts/reset-password.js admin "PasswordBaru"
// Butuh SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY di .env (jalur REST, tanpa Prisma).
"use strict";

const fs = require("node:fs");
const path = require("node:path");
(function loadEnv() {
  try {
    const p = path.join(__dirname, "..", ".env");
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  } catch { /* abaikan */ }
})();

const bcrypt = require("bcryptjs");
const sb = require("../lib/supabase");

async function main() {
  const [, , username = "admin", newPassword] = process.argv;

  if (!newPassword || newPassword.length < 6) {
    console.error("Pakai: node scripts/reset-password.js <username> <password-min-6>");
    process.exit(1);
  }

  const user = await sb.one("users", [sb.eq("username", username), sb.selCols("id")]);
  if (!user) {
    console.error(`User "${username}" tidak ditemukan.`);
    process.exit(1);
  }

  await sb.upd("users", { password_hash: await bcrypt.hash(newPassword, 10) }, [sb.eq("id", user.id)]);
  await sb.ins("audit_logs", [{
    actor_id: user.id, action: "RESET_PASSWORD", entity: "users",
    entity_id: user.id, detail: `Reset password ${username}`,
  }]);

  console.log(`Password user "${username}" berhasil direset.`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
