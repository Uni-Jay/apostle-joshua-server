// Usage: npm run create-admin -- "Full Name" email@example.com "temporary-password"
import bcrypt from 'bcryptjs';
import pool, { query } from '../config/database';
import { initDatabase } from '../database/init';

async function main() {
  const [name, email, pw] = process.argv.slice(2);
  if (!name || !email || !pw || pw.length < 8) {
    console.log('Usage: npm run create-admin -- "Full Name" email@example.com "temporary-password (8+ characters)"');
    process.exit(1);
  }
  await initDatabase();
  const owners = await query<any[]>("SELECT COUNT(*) AS n FROM admins WHERE role = 'owner'");
  await query('INSERT INTO admins (name, email, password_hash, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash)',
    [name, email.toLowerCase(), await bcrypt.hash(pw, 12), owners[0].n ? 'admin' : 'owner']);
  console.log(`Admin ready: ${email}`);
  await pool.end();
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
