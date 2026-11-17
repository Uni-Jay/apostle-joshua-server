import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../config/database';
import { requireAdmin } from '../middleware/auth';
import { bad, idParam, isEmail, str } from '../utils/helpers';
import { sendEmail, wrap, escapeHtml } from '../services/email.service';

const r = Router();
const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false, message: { message: 'You have sent several messages already. Please try again later.' } });

// "website" is a hidden field humans never fill in; bots usually do.
function isBot(b: any) { return !!(b && b.website); }

function notify(subject: string, lines: [string, string | null][]) {
  const to = process.env.NOTIFY_EMAIL;
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
  notify('New prayer request', [['Name', name], ['Phone', phone], ['Email', email], ['Request', request]]);
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
  notify(`New message: ${subject}`, [['Name', name], ['Phone', phone], ['Email', email], ['Message', body]]);
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
