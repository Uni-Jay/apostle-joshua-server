import { Router } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { query } from '../config/database';
import { AuthRequest, requireAdmin } from '../middleware/auth';
import { goOffline, onlineAgents, ping } from '../services/presence.service';
import { aiConfigured, aiModel, answer, clearAssistantCache, greeting, safetyOnly } from '../services/assistant.service';
import { escapeHtml, sendEmail, wrap } from '../services/email.service';
import { bad, idParam, str } from '../utils/helpers';

const r = Router();
const pollLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
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
r.get('/chat/config', async (_req, res) => { res.json({ ...(await greeting()), agentsOnline: onlineAgents().length }); });

async function addMsg(sessionId: string, role: string, text: string, source: string | null = null, author: string | null = null): Promise<number> {
  const out: any = await query('INSERT INTO chat_messages (session_id, role, text, source, author) VALUES (?,?,?,?,?)', [sessionId, role, text, source, author]);
  return out.insertId;
}
async function maxId(sessionId: string): Promise<number> {
  const [m] = await query<any[]>('SELECT COALESCE(MAX(id), 0) AS id FROM chat_messages WHERE session_id = ?', [sessionId]);
  return Number(m.id);
}

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

  const userMsgId = await addMsg(id, 'user', message);

  // Live chat: a team member is answering, so the assistant stays quiet (except for safety replies).
  if (session.mode === 'live') {
    await query('UPDATE chat_sessions SET msg_count = msg_count + 1, last_at = NOW(), seen = 0 WHERE id = ?', [id]);
    const urgent = await safetyOnly(message);
    if (urgent) {
      const botId = await addMsg(id, 'bot', urgent.text, 'safety');
      if (!session.urgent) {
        await query('UPDATE chat_sessions SET urgent = 1 WHERE id = ?', [id]);
        sendEmail(notifyTo(), 'URGENT: a website visitor may need help now', wrap('Urgent chat on the website', `<p>A visitor in live chat wrote something that suggests they may be in danger.</p>${await transcriptHtml(id)}<p><a href="${adminLink(id)}">Open the conversation</a></p>`)).catch(() => undefined);
      }
      return res.json({ sessionId: id, mode: 'live', userMsgId, reply: { id: botId, text: urgent.text, chips: [], action: urgent.action } });
    }
    return res.json({ sessionId: id, mode: 'live', userMsgId, reply: null });
  }

  // Automation: capture a phone number or email the visitor types, and tell the team.
  const phone = message.match(/(\+?234|0)[\s-]?[789][01]\d[\s-]?\d{3}[\s-]?\d{4}/)?.[0]?.replace(/[\s-]/g, '');
  const email = message.match(/[^\s@]+@[^\s@]+\.[a-z]{2,}/i)?.[0];
  const newContact = (phone && !session.phone) || (email && !session.email);
  if (phone && !session.phone) await query('UPDATE chat_sessions SET phone = ? WHERE id = ?', [phone, id]);
  if (email && !session.email) await query('UPDATE chat_sessions SET email = ? WHERE id = ?', [email.slice(0, 190), id]);

  const history = await query<any[]>('SELECT role, text FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 10', [id]);
  const reply = await answer(message, history.reverse());

  const botId = await addMsg(id, 'bot', reply.text, reply.source);
  await query('UPDATE chat_sessions SET msg_count = msg_count + 2, last_at = NOW(), seen = 0' + (reply.urgent ? ', urgent = 1' : '') + ' WHERE id = ?', [id]);

  // Automation: urgent chats and new contact details are emailed straight away.
  if (reply.urgent && !session.urgent) {
    sendEmail(notifyTo(), 'URGENT: a website visitor may need help now', wrap('Urgent chat on the website',
      `<p>A visitor wrote something that suggests they may be in danger. The assistant gave them emergency guidance (call 112). Please follow up if they leave contact details.</p>${await transcriptHtml(id)}<p><a href="${adminLink(id)}">Open the conversation</a></p>`)).catch(() => undefined);
  } else if (newContact) {
    sendEmail(notifyTo(), 'New contact from the website chat', wrap('A visitor shared their contact in the chat',
      `<p><b>Phone:</b> ${escapeHtml(phone || session.phone || '-')}<br><b>Email:</b> ${escapeHtml(email || session.email || '-')}</p>${await transcriptHtml(id)}<p><a href="${adminLink(id)}">Open the conversation</a></p>`)).catch(() => undefined);
  }

  res.json({ sessionId: id, mode: 'bot', userMsgId, reply: { id: botId, text: reply.text, chips: reply.chips || [], action: reply.action || null } });
});

/* Public: ask for a person (live chat) */
r.post('/chat/live', chatLimiter, async (req, res) => {
  let id: string = validSession(req.body?.sessionId) ? req.body.sessionId : '';
  const exists = id ? (await query<any[]>('SELECT id, mode FROM chat_sessions WHERE id = ?', [id]))[0] : null;
  if (!exists) { id = crypto.randomUUID(); await query('INSERT INTO chat_sessions (id, page) VALUES (?, ?)', [id, str(req.body?.page, 190)]); }
  const online = onlineAgents();
  const text = online.length
    ? `You're in the queue for live chat. 🙌 Someone from our team will join you here shortly. Go ahead and type your question.`
    : `Our team isn't online right now, but your messages here go straight to them. Type your question and **your phone or WhatsApp number**, and they'll reply here or on WhatsApp as soon as they can.`;
  if (!exists || exists.mode !== 'live') {
    await query("UPDATE chat_sessions SET mode = 'live', live_requested_at = NOW(), last_at = NOW(), seen = 0 WHERE id = ?", [id]);
    await addMsg(id, 'system', text);
    sendEmail(notifyTo(), 'A website visitor wants to chat live', wrap('Live chat request', `<p>A visitor asked to chat with a person on the website.${online.length ? '' : ' Nobody was online in the dashboard at the time.'}</p>${await transcriptHtml(id)}<p><a href="${adminLink(id)}">Open the conversation and reply</a></p>`)).catch(() => undefined);
  }
  res.json({ sessionId: id, mode: 'live', text, agentsOnline: online.length, lastId: await maxId(id) });
});

/* Public: go back to the assistant */
r.post('/chat/bot', chatLimiter, async (req, res) => {
  if (!validSession(req.body?.sessionId)) return bad(res, 'Unknown conversation.');
  const id = req.body.sessionId;
  await query("UPDATE chat_sessions SET mode = 'bot', agent_name = NULL WHERE id = ?", [id]);
  const text = `You're back with the assistant. Tap "Talk to a person" any time to reach the team again.`;
  await addMsg(id, 'system', text);
  res.json({ mode: 'bot', text, lastId: await maxId(id) });
});

/* Public: new replies from the team (polled every few seconds while in live chat) */
r.get('/chat/poll', pollLimiter, async (req, res) => {
  const id = String(req.query.sessionId || '');
  if (!validSession(id)) return bad(res, 'Unknown conversation.');
  const after = Math.max(0, parseInt(String(req.query.after || '0'), 10) || 0);
  const [s] = await query<any[]>('SELECT mode, agent_name FROM chat_sessions WHERE id = ?', [id]);
  if (!s) return res.status(404).json({ message: 'Conversation not found.' });
  const messages = await query("SELECT id, role, text, author, created_at FROM chat_messages WHERE session_id = ? AND id > ? AND role IN ('agent','system') ORDER BY id ASC LIMIT 50", [id, after]);
  res.json({ mode: s.mode, agentName: s.agent_name, agentsOnline: onlineAgents().length, messages });
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
  const after = Math.max(0, parseInt(String(req.query.after || '0'), 10) || 0);
  res.json({ session: { ...s, seen: 1 }, messages: await query('SELECT id, role, text, source, author, created_at FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id ASC', [s.id, after]) });
});
r.post('/admin/presence', requireAdmin, async (req: AuthRequest, res) => {
  const me = req.user!;
  if (req.body?.offline) goOffline(me.id); else ping(me.id, (me.name || 'Team').split(' ')[0], req.body?.available !== false);
  const waiting = await query<any[]>(`SELECT s.id, s.name, s.phone, s.live_requested_at,
      (SELECT text FROM chat_messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_text,
      (SELECT role FROM chat_messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_role
    FROM chat_sessions s WHERE s.mode = 'live' AND s.last_at >= (NOW() - INTERVAL 1 DAY) ORDER BY s.last_at DESC LIMIT 20`);
  res.json({ online: onlineAgents(), waiting: waiting.filter((w) => w.last_role === 'user' || w.last_role === 'system') });
});
r.post('/admin/chats/:id/reply', requireAdmin, async (req: AuthRequest, res) => {
  if (!validSession(req.params.id)) return bad(res, 'Unknown conversation.');
  const text = str(req.body?.text, 2000);
  if (!text) return bad(res, 'Please type a reply.');
  const [s] = await query<any[]>('SELECT id, agent_name FROM chat_sessions WHERE id = ?', [req.params.id]);
  if (!s) return res.status(404).json({ message: 'Conversation not found.' });
  const first = (req.user?.name || 'Team').split(' ')[0];
  if (s.agent_name !== first) await addMsg(s.id, 'system', `${first} from the team has joined the chat.`);
  await addMsg(s.id, 'agent', text, 'agent', first);
  await query("UPDATE chat_sessions SET mode = 'live', agent_name = ?, seen = 1, last_at = NOW(), msg_count = msg_count + 1 WHERE id = ?", [first, s.id]);
  res.status(201).json({ message: 'Sent.' });
});
r.post('/admin/chats/:id/end', requireAdmin, async (req, res) => {
  if (!validSession(req.params.id)) return bad(res, 'Unknown conversation.');
  await query("UPDATE chat_sessions SET mode = 'bot', agent_name = NULL WHERE id = ?", [req.params.id]);
  await addMsg(req.params.id, 'system', 'The team member has left the chat. The assistant is here if you need anything else. God bless you! 🙏');
  res.json({ message: 'Live chat ended.' });
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
