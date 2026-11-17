import { Router } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { query } from '../config/database';
import { requireAdmin } from '../middleware/auth';
import { aiConfigured, aiModel, answer, clearAssistantCache, greeting } from '../services/assistant.service';
import { escapeHtml, sendEmail, wrap } from '../services/email.service';
import { bad, idParam, str } from '../utils/helpers';

const r = Router();
const chatLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { message: 'You are sending messages quickly. Please wait a moment.' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validSession = (v: any) => typeof v === 'string' && UUID.test(v);
const notifyTo = () => process.env.NOTIFY_EMAIL || 'apostlejoshuaaogiriosa@gmail.com';
const adminLink = (id: string) => `${(process.env.CLIENT_URL || '').replace(/\/$/, '')}/admin/chat?c=${id}`;

async function transcriptHtml(id: string) {
  const msgs = await query<any[]>('SELECT role, text FROM chat_messages WHERE session_id = ? ORDER BY id ASC LIMIT 60', [id]);
  return msgs.map((m) => `<p style="margin:6px 0"><b>${m.role === 'user' ? 'Visitor' : 'Assistant'}:</b> ${escapeHtml(m.text).replace(/\n/g, '<br>')}</p>`).join('');
}

/* Public: widget config */
r.get('/chat/config', async (_req, res) => { res.json(await greeting()); });

/* Public: send a message, get a reply */
r.post('/chat', chatLimiter, async (req, res) => {
  const b = req.body || {};
  const message = str(b.message, 1000);
  if (!message) return bad(res, 'Please type a message.');
  const cfg = await greeting();
  if (!cfg.enabled) return res.status(503).json({ message: 'The chat assistant is switched off right now.' });

  let id: string = validSession(b.sessionId) ? b.sessionId : '';
  let session = id ? (await query<any[]>('SELECT * FROM chat_sessions WHERE id = ?', [id]))[0] : null;
  if (!session) {
    id = crypto.randomUUID();
    await query('INSERT INTO chat_sessions (id, page) VALUES (?, ?)', [id, str(b.page, 190)]);
    session = { id, phone: null, email: null, urgent: 0, msg_count: 0 };
  }
  if (session.msg_count >= 200) return res.status(429).json({ message: 'This conversation is very long. Please continue on WhatsApp.' });

  await query('INSERT INTO chat_messages (session_id, role, text) VALUES (?,?,?)', [id, 'user', message]);

  // Automation: capture a phone number or email the visitor types, and tell the team.
  const phone = message.match(/(\+?234|0)[\s-]?[789][01]\d[\s-]?\d{3}[\s-]?\d{4}/)?.[0]?.replace(/[\s-]/g, '');
  const email = message.match(/[^\s@]+@[^\s@]+\.[a-z]{2,}/i)?.[0];
  const newContact = (phone && !session.phone) || (email && !session.email);
  if (phone && !session.phone) await query('UPDATE chat_sessions SET phone = ? WHERE id = ?', [phone, id]);
  if (email && !session.email) await query('UPDATE chat_sessions SET email = ? WHERE id = ?', [email.slice(0, 190), id]);

  const history = await query<any[]>('SELECT role, text FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 10', [id]);
  const reply = await answer(message, history.reverse());

  await query('INSERT INTO chat_messages (session_id, role, text, source) VALUES (?,?,?,?)', [id, 'bot', reply.text, reply.source]);
  await query('UPDATE chat_sessions SET msg_count = msg_count + 2, last_at = NOW(), seen = 0' + (reply.urgent ? ', urgent = 1' : '') + ' WHERE id = ?', [id]);

  // Automation: urgent chats and new contact details are emailed straight away.
  if (reply.urgent && !session.urgent) {
    sendEmail(notifyTo(), 'URGENT: a website visitor may need help now', wrap('Urgent chat on the website',
      `<p>A visitor wrote something that suggests they may be in danger. The assistant gave them emergency guidance (call 112). Please follow up if they leave contact details.</p>${await transcriptHtml(id)}<p><a href="${adminLink(id)}">Open the conversation</a></p>`)).catch(() => undefined);
  } else if (newContact) {
    sendEmail(notifyTo(), 'New contact from the website chat', wrap('A visitor shared their contact in the chat',
      `<p><b>Phone:</b> ${escapeHtml(phone || session.phone || '-')}<br><b>Email:</b> ${escapeHtml(email || session.email || '-')}</p>${await transcriptHtml(id)}<p><a href="${adminLink(id)}">Open the conversation</a></p>`)).catch(() => undefined);
  }

  res.json({ sessionId: id, reply: { text: reply.text, chips: reply.chips || [], action: reply.action || null } });
});

/* ---------- Admin: conversations ---------- */
r.get('/admin/chats', requireAdmin, async (_req, res) => {
  res.json(await query(`SELECT s.*, (SELECT text FROM chat_messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.id ASC LIMIT 1) AS first_message
    FROM chat_sessions s ORDER BY s.last_at DESC LIMIT 300`));
});
r.get('/admin/chats/:id', requireAdmin, async (req, res) => {
  if (!validSession(req.params.id)) return bad(res, 'Unknown conversation.');
  const [s] = await query<any[]>('SELECT * FROM chat_sessions WHERE id = ?', [req.params.id]);
  if (!s) return res.status(404).json({ message: 'Conversation not found.' });
  await query('UPDATE chat_sessions SET seen = 1 WHERE id = ?', [s.id]);
  res.json({ session: { ...s, seen: 1 }, messages: await query('SELECT id, role, text, source, created_at FROM chat_messages WHERE session_id = ? ORDER BY id ASC', [s.id]) });
});
r.delete('/admin/chats/:id', requireAdmin, async (req, res) => {
  if (!validSession(req.params.id)) return bad(res, 'Unknown conversation.');
  await query('DELETE FROM chat_messages WHERE session_id = ?', [req.params.id]);
  await query('DELETE FROM chat_sessions WHERE id = ?', [req.params.id]);
  res.json({ message: 'Deleted.' });
});
r.get('/admin/assistant', requireAdmin, async (_req, res) => {
  const [n] = await query<any[]>("SELECT COUNT(*) AS total, SUM(source = 'ai') AS ai, SUM(source = 'fallback') AS unanswered FROM chat_messages WHERE role = 'bot' AND created_at >= (NOW() - INTERVAL 30 DAY)");
  res.json({ aiConfigured: aiConfigured(), model: aiModel(), last30: { replies: Number(n.total || 0), ai: Number(n.ai || 0), unanswered: Number(n.unanswered || 0) } });
});

/* ---------- Admin: FAQs ---------- */
function faqBody(b: any) {
  const question = str(b.question, 255), answer = str(b.answer, 3000);
  const keywords = (str(b.keywords, 500) || '').split(',').map((k) => k.trim().toLowerCase()).filter(Boolean).join(',');
  return { question, answer, keywords, active: b.active === false || b.active === 0 ? 0 : 1, sort_order: Number.isFinite(+b.sort_order) ? +b.sort_order : 0 };
}
r.get('/admin/faqs', requireAdmin, async (_req, res) => { res.json(await query('SELECT * FROM faqs ORDER BY sort_order, id')); });
r.post('/admin/faqs', requireAdmin, async (req, res) => {
  const f = faqBody(req.body || {});
  if (!f.question || !f.answer) return bad(res, 'Please add the question and the answer.');
  await query('INSERT INTO faqs (question, answer, keywords, active, sort_order) VALUES (?,?,?,?,?)', [f.question, f.answer, f.keywords, f.active, f.sort_order]);
  clearAssistantCache(); res.status(201).json({ message: 'Saved.' });
});
r.put('/admin/faqs/:id', requireAdmin, async (req, res) => {
  const f = faqBody(req.body || {});
  if (!f.question || !f.answer) return bad(res, 'Please add the question and the answer.');
  await query('UPDATE faqs SET question = ?, answer = ?, keywords = ?, active = ?, sort_order = ? WHERE id = ?', [f.question, f.answer, f.keywords, f.active, f.sort_order, idParam(req.params.id)]);
  clearAssistantCache(); res.json({ message: 'Saved.' });
});
r.delete('/admin/faqs/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM faqs WHERE id = ?', [idParam(req.params.id)]);
  clearAssistantCache(); res.json({ message: 'Deleted.' });
});

export default r;
