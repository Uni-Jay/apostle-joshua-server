import bcrypt from 'bcryptjs';
import { query } from '../config/database';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'admin',
    last_login DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS password_resets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    admin_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    used TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (token_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS sermons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'sermon',
    youtube_id VARCHAR(20) NOT NULL,
    speaker VARCHAR(120) NOT NULL DEFAULT 'Apostle Joshua',
    scripture VARCHAR(160) NULL,
    description TEXT NULL,
    duration VARCHAR(20) NULL,
    preached_on DATE NULL,
    date_approx TINYINT(1) NOT NULL DEFAULT 0,
    featured TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    starts_on DATE NULL,
    time_text VARCHAR(80) NULL,
    venue VARCHAR(255) NULL,
    description TEXT NULL,
    image_url VARCHAR(500) NULL,
    is_past TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS gallery (
    id INT AUTO_INCREMENT PRIMARY KEY,
    url VARCHAR(500) NOT NULL,
    public_id VARCHAR(255) NULL,
    caption VARCHAR(255) NULL,
    category VARCHAR(30) NOT NULL DEFAULT 'photo',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    excerpt VARCHAR(500) NULL,
    body MEDIUMTEXT NOT NULL,
    scripture VARCHAR(160) NULL,
    cover_url VARCHAR(500) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    published_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS prayer_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    phone VARCHAR(40) NULL,
    email VARCHAR(190) NULL,
    request TEXT NOT NULL,
    is_private TINYINT(1) NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'new',
    notes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    phone VARCHAR(40) NULL,
    email VARCHAR(190) NULL,
    subject VARCHAR(120) NOT NULL DEFAULT 'General enquiry',
    body TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'new',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    skey VARCHAR(60) PRIMARY KEY,
    svalue TEXT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_sessions (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(120) NULL,
    phone VARCHAR(40) NULL,
    email VARCHAR(190) NULL,
    page VARCHAR(190) NULL,
    msg_count INT NOT NULL DEFAULT 0,
    urgent TINYINT(1) NOT NULL DEFAULT 0,
    seen TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (last_at)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    role VARCHAR(10) NOT NULL,
    text TEXT NOT NULL,
    source VARCHAR(20) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (session_id)
  )`,
  `CREATE TABLE IF NOT EXISTS faqs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question VARCHAR(255) NOT NULL,
    answer TEXT NOT NULL,
    keywords VARCHAR(500) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

// Starter answers for the chat assistant. The admin can edit or delete them under Chat assistant > FAQs.
const STARTER_FAQS: [string, string, string][] = [
  ['Is Apostle Joshua Outreach a church?', 'No. Apostle Joshua Outreach is an outreach, not a church. We teach sound apostolic doctrine (the New Testament message) and hold prayer meetings, crusades, seminars and conferences. You are welcome at our programmes whatever church you attend.', 'church,member,denomination,join church,outreach'],
  ['What does the outreach teach?', 'We teach sound apostolic doctrine: the New Testament message as the apostles preached it. You can watch the teachings on the [Sermons page](/sermons).', 'teach,doctrine,believe,belief,apostolic,new testament,message'],
  ['Can Apostle Joshua come to minister at our programme?', 'Yes, you can send an invitation. Share your programme details and the team will get back to you.', 'invite,invitation,minister,preach at,programme,program,come to our'],
  ['Do you help people find jobs or support the needy?', 'Helping people find jobs and supporting the needy is part of our vision for the future, as God provides the funds. For now we can pray with you, and you are welcome to leave your details.', 'job,work,employment,needy,welfare,food,money,financial,help me'],
];

export async function initDatabase(): Promise<void> {
  for (const sql of TABLES) await query(sql);
  await ensureFirstAdmin();
  // Live chat columns (added after first release; safe to run every start).
  await ensureColumn('chat_sessions', 'mode', "VARCHAR(10) NOT NULL DEFAULT 'bot'");
  await ensureColumn('chat_sessions', 'live_requested_at', 'DATETIME NULL');
  await ensureColumn('chat_sessions', 'agent_name', 'VARCHAR(120) NULL');
  await ensureColumn('chat_messages', 'author', 'VARCHAR(120) NULL');
  const [f] = await query<any[]>('SELECT COUNT(*) AS n FROM faqs');
  if (Number(f.n) === 0) for (const [i, [q, a, k]] of STARTER_FAQS.entries()) await query('INSERT INTO faqs (question, answer, keywords, sort_order) VALUES (?,?,?,?)', [q, a, k, i]);
  // Keep the chat log tidy: remove conversations older than 180 days.
  await query('DELETE FROM chat_messages WHERE created_at < (NOW() - INTERVAL 180 DAY)');
  await query('DELETE FROM chat_sessions WHERE last_at < (NOW() - INTERVAL 180 DAY)');
}

async function ensureColumn(table: string, col: string, def: string) {
  const rows = await query<any[]>('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, col]);
  if (Number(rows[0].n) === 0) await query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

// On first boot, create the first admin from ADMIN_EMAIL + ADMIN_TEMP_PASSWORD (set in the host's environment).
async function ensureFirstAdmin(): Promise<void> {
  const rows = await query<any[]>('SELECT COUNT(*) AS n FROM admins');
  if (rows[0].n > 0) return;
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const pw = process.env.ADMIN_TEMP_PASSWORD || '';
  if (!email || pw.length < 8) {
    console.warn('No admin account yet. Set ADMIN_EMAIL and ADMIN_TEMP_PASSWORD (8+ characters) and restart to create one.');
    return;
  }
  const hash = await bcrypt.hash(pw, 12);
  await query('INSERT INTO admins (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [process.env.ADMIN_NAME || 'Administrator', email, hash, 'owner']);
  console.log(`Created the first admin account for ${email}. Sign in and change the password.`);
}
