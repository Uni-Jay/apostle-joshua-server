import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { query } from '../config/database';
import { requireAdmin, signToken, AuthRequest } from '../middleware/auth';
import { bad, isEmail, str, idParam } from '../utils/helpers';
import { sendEmail, wrap, escapeHtml } from '../services/email.service';

const r = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many attempts. Please wait 15 minutes and try again.' } });
const resetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many requests. Please try again later.' } });

r.post('/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return bad(res, 'Enter your email and password.');
  const rows = await query<any[]>('SELECT * FROM admins WHERE email = ? LIMIT 1', [email]);
  const a = rows[0];
  if (!a || !(await bcrypt.compare(password, a.password_hash))) return bad(res, 'That email or password is not correct.', 401);
  await query('UPDATE admins SET last_login = NOW() WHERE id = ?', [a.id]);
  const user = { id: a.id, email: a.email, name: a.name, role: a.role };
  res.json({ token: signToken(user), user });
});

r.get('/me', requireAdmin, (req: AuthRequest, res) => res.json({ user: req.user }));

r.post('/change-password', requireAdmin, async (req: AuthRequest, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (next.length < 8) return bad(res, 'Your new password must be at least 8 characters.');
  const rows = await query<any[]>('SELECT password_hash FROM admins WHERE id = ?', [req.user!.id]);
  if (!rows[0] || !(await bcrypt.compare(current, rows[0].password_hash))) return bad(res, 'Your current password is not correct.');
  await query('UPDATE admins SET password_hash = ? WHERE id = ?', [await bcrypt.hash(next, 12), req.user!.id]);
  res.json({ message: 'Password changed.' });
});

// Always answers the same way, so the form can't be used to discover which emails have accounts.
r.post('/forgot-password', resetLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const reply = { message: 'If that email belongs to an admin, a reset link is on its way.' };
  if (!isEmail(email)) return res.json(reply);
  const rows = await query<any[]>('SELECT id, name FROM admins WHERE email = ?', [email]);
  if (!rows[0]) return res.json(reply);
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const ttl = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES) || 30;
  await query('INSERT INTO password_resets (admin_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))', [rows[0].id, hash, ttl]);
  const base = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
  const link = `${base}/admin/reset-password?token=${token}`;
  await sendEmail(email, 'Reset your admin password', wrap('Reset your password', `<p>Hello ${escapeHtml(rows[0].name)},</p><p>Use the button below to choose a new password for the Apostle Joshua Outreach admin. The link works for ${ttl} minutes.</p><p><a href="${link}" style="display:inline-block;background:#F4C95D;color:#0A0640;padding:12px 18px;border-radius:999px;font-weight:bold;text-decoration:none">Choose a new password</a></p><p>If you didn't ask for this, you can ignore this email.</p>`));
  res.json(reply);
});

r.post('/reset-password', resetLimiter, async (req, res) => {
  const token = String(req.body?.token || '');
  const pw = String(req.body?.password || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return bad(res, 'This reset link is not valid. Please request a new one.');
  if (pw.length < 8) return bad(res, 'Your new password must be at least 8 characters.');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const rows = await query<any[]>('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > NOW() LIMIT 1', [hash]);
  if (!rows[0]) return bad(res, 'This reset link has expired. Please request a new one.');
  await query('UPDATE admins SET password_hash = ? WHERE id = ?', [await bcrypt.hash(pw, 12), rows[0].admin_id]);
  await query('UPDATE password_resets SET used = 1 WHERE admin_id = ?', [rows[0].admin_id]);
  res.json({ message: 'Password updated. You can sign in now.' });
});

// Team: the owner can add or remove other admins.
r.get('/admins', requireAdmin, async (_req, res) => {
  res.json(await query('SELECT id, name, email, role, last_login, created_at FROM admins ORDER BY created_at'));
});
r.post('/admins', requireAdmin, async (req: AuthRequest, res) => {
  if (req.user!.role !== 'owner') return bad(res, 'Only the owner can add admins.', 403);
  const name = str(req.body?.name, 120), email = String(req.body?.email || '').trim().toLowerCase(), pw = String(req.body?.password || '');
  if (!name || !isEmail(email)) return bad(res, 'Enter a name and a valid email.');
  if (pw.length < 8) return bad(res, 'The temporary password must be at least 8 characters.');
  const exists = await query<any[]>('SELECT id FROM admins WHERE email = ?', [email]);
  if (exists[0]) return bad(res, 'That email already has an admin account.');
  await query('INSERT INTO admins (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [name, email, await bcrypt.hash(pw, 12), 'admin']);
  res.status(201).json({ message: 'Admin added.' });
});
r.delete('/admins/:id', requireAdmin, async (req: AuthRequest, res) => {
  if (req.user!.role !== 'owner') return bad(res, 'Only the owner can remove admins.', 403);
  const id = idParam(req.params.id);
  if (id === req.user!.id) return bad(res, 'You cannot remove your own account.');
  await query("DELETE FROM admins WHERE id = ? AND role <> 'owner'", [id]);
  res.json({ message: 'Admin removed.' });
});

export default r;
