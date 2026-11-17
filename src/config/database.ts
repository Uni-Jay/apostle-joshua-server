import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// TiDB Cloud (and most hosted MySQL) require an encrypted connection: set DB_SSL=true
function dbSsl(): any {
  const on = (process.env.DB_SSL || '').toLowerCase();
  if (on === 'true' || on === '1' || on === 'required') return { minVersion: 'TLSv1.2', rejectUnauthorized: true };
  return undefined;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'apostle_joshua_db',
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

export default pool;

export async function query<T = any>(sql: string, params: any[] = []): Promise<T> {
  const [rows] = await pool.query(sql, params);
  return rows as T;
}
