// Manual run: `npm run seed`. (A new, empty database is filled automatically on first start.)
import pool from '../config/database';
import { initDatabase } from './init';
import { seedContent } from './seedData';

async function main() {
  await initDatabase();
  const added = await seedContent();
  console.log(`Seed complete: ${added} videos added.`);
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
