import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../config/database';
import { requireAdmin } from '../middleware/auth';
import { bad, idParam, isEmail, str } from '../utils/helpers';
import { sendEmail, wrap, escapeHtml } from '../services/email.service';
import { query as q2 } from '../config/database';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Automation: when a form is sent from inside the chat, attach it to that conversation.
async function linkChat(sessionId: any, name: string, phone: string | null, email: string | null, note: string) {
  if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) return;
  await q2('UPDATE chat_sessions SET name = COALESCE(name, ?), phone = COALESCE(phone, ?), email = COALESCE(email, ?), last_at = NOW(), seen = 0 WHERE id = ?', [name, phone, email, sessionId]);
  await q2('INSERT INTO chat_messages (session_id, role, text, source) SELECT id, ?, ?, ? FROM chat_sessions WHERE id = ?', ['bot', note, 'form', sessionId]);
}

// Automation: a short thank-you email to visitors who leave an email address.
function thankVisitor(email: string | null, name: string, subject: string, body: string) {
  if (!email) return;
  sendEmail(email, subject, wrap(subject, `<p>Dear ${escapeHtml(name)},</p>${body}<p>God bless you,<br>Apostle Joshua Outreach</p>`)).catch(() => undefined);
}

const r = Router();
const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false, message: { message: 'You have sent several messages already. Please try again later.' } });

// "website" is a hidden field humans never fill in; bots usually do.
function isBot(b: any) { return !!(b && b.website); }

function notify(subject: string, lines: [string, string | null][]) {
  const to = process.env.NOTIFY_EMAIL || 'apostlejoshuaaogiriosa@gmail.com';
  if (!to) return;
  const body = lines.filter(([, v]) => v).map(([k, v]) => `<p><b>${k}:</b><br>${escapeHtml(String(v)).replace(/\n/g, '<br>')}</p>`).join('');
  sendEmail(to, subject, wrap(subject, body)).catch(() => undefined);
}

/* ---------- Prayer requests ---------- */
r.post('/prayer-requests', submitLimiter, async (req, res) => {
  const b = req.body || {};
  if (isBot(b)) return res.status(201).json({ message: 'Received.' });
  const name = str(b.name, 120), request = str(b.request, 4000), email = str(b.email, 190), phone = str(b.phone, 40);
  if (!name) return bad(res, 'Please enter your name.');
  if (!request || request.length < 5) return bad(res, 'Please tell us how we can pray for you.');
  if (email && !isEmail(email)) return bad(res, 'Please check your email address.');
  await query('INSERT INTO prayer_requests (name, phone, email, request, is_private) VALUES (?,?,?,?,?)', [name, phone, email, request, b.is_private === false ? 0 : 1]);
  notify(b.chat_session ? 'New prayer request (from website chat)' : 'New prayer request', [['Name', name], ['Phone', phone], ['Email', email], ['Request', request]]);
  thankVisitor(email, name, 'We received your prayer request', '<p>Thank you for sharing your prayer request with us. Apostle Joshua and the prayer team have received it and are standing with you in prayer.</p><p>"The effectual fervent prayer of a righteous man availeth much." (James 5:16)</p>');
  await linkChat(b.chat_session, name, phone, email, `✅ Prayer request received from ${name}:\n${request}`);
  res.status(201).json({ message: 'Thank you. We have received your request and we are praying with you.' });
});
r.get('/prayer-requests', requireAdmin, async (req, res) => {
  const st = String(req.query.status || '');
  const rows = ['new', 'praying', 'answered'].includes(st)
    ? await query('SELECT * FROM prayer_requests WHERE status = ? ORDER BY created_at DESC', [st])
    : await query('SELECT * FROM prayer_requests ORDER BY created_at DESC LIMIT 500');
  res.json(rows);
});
r.patch('/prayer-requests/:id', requireAdmin, async (req, res) => {
  const status = String(req.body?.status || '');
  if (!['new', 'praying', 'answered'].includes(status)) return bad(res, 'Unknown status.');
  await query('UPDATE prayer_requests SET status = ?, notes = COALESCE(?, notes) WHERE id = ?', [status, str(req.body?.notes, 4000), idParam(req.params.id)]);
  res.json({ message: 'Updated.' });
});
r.delete('/prayer-requests/:id', requireAdmin, async (req, res) => { await query('DELETE FROM prayer_requests WHERE id = ?', [idParam(req.params.id)]); res.json({ message: 'Deleted.' }); });

/* ---------- Contact messages ---------- */
const SUBJECTS = ['Planning a visit', 'I want to volunteer', 'Invite Apostle Joshua', 'Events', 'Partnership', 'General enquiry'];
r.post('/messages', submitLimiter, async (req, res) => {
  const b = req.body || {};
  if (isBot(b)) return res.status(201).json({ message: 'Received.' });
  const name = str(b.name, 120), body = str(b.body, 4000), email = str(b.email, 190), phone = str(b.phone, 40);
  const subject = SUBJECTS.includes(b.subject) ? b.subject : 'General enquiry';
  if (!name) return bad(res, 'Please enter your name.');
  if (!body) return bad(res, 'Please write your message.');
  if (!email && !phone) return bad(res, 'Please add a phone number or email so we can reply.');
  if (email && !isEmail(email)) return bad(res, 'Please check your email address.');
  await query('INSERT INTO messages (name, phone, email, subject, body) VALUES (?,?,?,?,?)', [name, phone, email, subject, body]);
  notify(`New message: ${subject}${b.chat_session ? ' (from website chat)' : ''}`, [['Name', name], ['Phone', phone], ['Email', email], ['Message', body]]);
  thankVisitor(email, name, 'We received your message', `<p>Thank you for contacting Apostle Joshua Outreach about <b>${escapeHtml(subject)}</b>. Our team has received your message and will get back to you soon.</p>`);
  await linkChat(b.chat_session, name, phone, email, `✅ Message sent (${subject}) from ${name}:\n${body}`);
  res.status(201).json({ message: 'Thank you. Your message has been sent and we will get back to you soon.' });
});
r.get('/messages', requireAdmin, async (_req, res) => { res.json(await query('SELECT * FROM messages ORDER BY created_at DESC LIMIT 500')); });
r.patch('/messages/:id', requireAdmin, async (req, res) => {
  const status = req.body?.status === 'read' ? 'read' : 'new';
  await query('UPDATE messages SET status = ? WHERE id = ?', [status, idParam(req.params.id)]);
  res.json({ message: 'Updated.' });
});
r.delete('/messages/:id', requireAdmin, async (req, res) => { await query('DELETE FROM messages WHERE id = ?', [idParam(req.params.id)]); res.json({ message: 'Deleted.' }); });

export default r;
