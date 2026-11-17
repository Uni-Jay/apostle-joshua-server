import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// TiDB Cloud (and most hosted MySQL) require an encrypted connection: set DB_SSL=true
function dbSsl(): any {
  const on = (process.env.DB_SSL || '').toLowerCase();
  if (on === 'true' || on === '1' || on === 'required') return { minVersion: 'TLSv1.2', rejectUnauthorized: true };
  return undefined;
}

const DB_NAME = process.env.DB_NAME || 'apostle_joshua_db';

/** Creates the database itself if it doesn't exist yet (e.g. a fresh TiDB Cloud cluster). */
export async function ensureDatabase(): Promise<void> {
  if (!/^[A-Za-z0-9_]+$/.test(DB_NAME)) throw new Error('DB_NAME may only contain letters, numbers and underscores');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
    port: parseInt(process.env.DB_PORT || '3306', 10), ssl: dbSsl(), connectTimeout: 30000,
  });
  try { await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``); } finally { await conn.end(); }
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: DB_NAME,
  port: parseInt(process.env.DB_PORT || '3306', 10),
  ssl: dbSsl(),
  waitForConnections: true,
  // TiDB's free tier allows few connections; keep the pool small
  connectionLimit: Number(process.env.DB_POOL_SIZE) || 3,
  queueLimit: 0,
  connectTimeout: 30000,
  enableKeepAlive: true,
  dateStrings: true,
});

// Store and compare all timestamps in UTC; the website shows them in the visitor's local time.
(pool as any).pool.on('connection', (conn: any) => conn.query("SET time_zone = '+00:00'"));

export default pool;

export async function query<T = any>(sql: string, params: any[] = []): Promise<T> {
  const [rows] = await pool.query(sql, params);
  return rows as T;
}
