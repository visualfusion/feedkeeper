import { runMigrations, db } from "./db/index.js";
import { findUserByEmail } from "./auth/users.js";
import { revokeSecuritySessions, securityAccount } from "./auth/security.js";

const args = process.argv.slice(2);
const emailIndex = args.indexOf("--email");
const email = emailIndex >= 0 ? args[emailIndex + 1] : undefined;
if (!email || !args.includes("--confirm")) {
  console.error("Usage: npm run security:recover -- --email reader@example.com --confirm\nDisables the authenticator and recovery codes for this account and revokes all sessions, tokens and pending sign-ins. Password and passkeys stay unchanged. Requires local database access.");
  process.exitCode = 1;
} else {
  runMigrations();
  const user = findUserByEmail(email);
  if (!user) { console.error("Account not found."); process.exitCode = 1; }
  else {
    db.transaction(() => {
      securityAccount(user.id);
      db.prepare("UPDATE account_security SET totp_secret = NULL, totp_last_step = -1 WHERE user_id = ?").run(user.id);
      db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(user.id);
      revokeSecuritySessions(user.id);
    })();
    console.log("Authenticator removed. The account must sign in again. Set up a new authenticator and save new recovery codes.");
  }
}
db.close();
