import { clearAssistantCache } from '../services/assistant.service';
import { Router } from 'express';
import multer from 'multer';
import { query } from '../config/database';
import { requireAdmin } from '../middleware/auth';
import { bad, idParam, isDate, slugify, str, youtubeId, SERMON_TYPES } from '../utils/helpers';
import { saveImage, deleteImage } from '../services/media.service';

const r = Router();
// Any change to sermons or events refreshes what the chat assistant knows.
r.use((req, _res, next) => { if (req.method !== 'GET' && /^\/(sermons|events)/.test(req.path)) clearAssistantCache(); next(); });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (_req, f, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(f.mimetype)),
});

/* ---------------- Sermons ---------------- */
function sermonOut(s: any) {
  return { ...s, date_approx: !!s.date_approx, featured: !!s.featured, url: `https://www.youtube.com/watch?v=${s.youtube_id}`, thumbnail: `https://i.ytimg.com/vi/${s.youtube_id}/hqdefault.jpg` };
}
r.get('/sermons', async (req, res) => {
  const where: string[] = []; const p: any[] = [];
  const type = String(req.query.type || '');
  if (SERMON_TYPES.includes(type)) { where.push('type = ?'); p.push(type); }
  const q = String(req.query.q || '').trim();
  if (q) { where.push('(title LIKE ? OR scripture LIKE ? OR description LIKE ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '60'), 10) || 60, 1), 200);
  const rows = await query<any[]>(`SELECT * FROM sermons ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY featured DESC, preached_on IS NULL, preached_on DESC, created_at DESC LIMIT ${limit}`, p);
  res.json(rows.map(sermonOut));
});
function sermonIn(b: any) {
  const yid = youtubeId(b.url || b.youtube_id);
  const type = SERMON_TYPES.includes(b.type) ? b.type : 'sermon';
  return { yid, title: str(b.title), type, speaker: str(b.speaker, 120) || 'Apostle Joshua', scripture: str(b.scripture, 160), description: str(b.description, 5000), duration: str(b.duration, 20),
    preached_on: isDate(b.preached_on) ? b.preached_on : null, date_approx: b.date_approx ? 1 : 0, featured: b.featured ? 1 : 0 };
}
r.post('/sermons', requireAdmin, async (req, res) => {
  const s = sermonIn(req.body || {});
  if (!s.yid) return bad(res, 'Please paste a YouTube link (from YouTube’s Share button).');
  if (!s.title) return bad(res, 'Please add a title.');
  if (s.featured) await query('UPDATE sermons SET featured = 0');
  const out: any = await query('INSERT INTO sermons (title, type, youtube_id, speaker, scripture, description, duration, preached_on, date_approx, featured) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [s.title, s.type, s.yid, s.speaker, s.scripture, s.description, s.duration, s.preached_on, s.date_approx, s.featured]);
  res.status(201).json({ id: out.insertId });
});
r.put('/sermons/:id', requireAdmin, async (req, res) => {
  const id = idParam(req.params.id); const s = sermonIn(req.body || {});
  if (!s.yid || !s.title) return bad(res, 'A title and a YouTube link are required.');
  if (s.featured) await query('UPDATE sermons SET featured = 0 WHERE id <> ?', [id]);
  await query('UPDATE sermons SET title=?, type=?, youtube_id=?, speaker=?, scripture=?, description=?, duration=?, preached_on=?, date_approx=?, featured=? WHERE id=?',
    [s.title, s.type, s.yid, s.speaker, s.scripture, s.description, s.duration, s.preached_on, s.date_approx, s.featured, id]);
  res.json({ message: 'Saved.' });
});
r.delete('/sermons/:id', requireAdmin, async (req, res) => { await query('DELETE FROM sermons WHERE id = ?', [idParam(req.params.id)]); res.json({ message: 'Deleted.' }); });

/* ---------------- Events ---------------- */
r.get('/events', async (_req, res) => {
  const rows = await query<any[]>('SELECT * FROM events ORDER BY starts_on IS NULL, starts_on DESC');
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = rows.filter((e) => !e.is_past && e.starts_on && e.starts_on >= today).sort((a, b) => (a.starts_on < b.starts_on ? -1 : 1));
  const past = rows.filter((e) => !upcoming.includes(e));
  res.json({ upcoming, past });
});
function eventIn(b: any) {
  return { title: str(b.title), starts_on: isDate(b.starts_on) ? b.starts_on : null, time_text: str(b.time_text, 80), venue: str(b.venue), description: str(b.description, 5000), is_past: b.is_past ? 1 : 0 };
}
r.post('/events', requireAdmin, async (req, res) => {
  const e = eventIn(req.body || {});
  if (!e.title) return bad(res, 'Please add the event name.');
  if (!e.starts_on && !e.is_past) return bad(res, 'Please add the event date.');
  const out: any = await query('INSERT INTO events (title, starts_on, time_text, venue, description, is_past) VALUES (?,?,?,?,?,?)', [e.title, e.starts_on, e.time_text, e.venue, e.description, e.is_past]);
  res.status(201).json({ id: out.insertId });
});
r.put('/events/:id', requireAdmin, async (req, res) => {
  const e = eventIn(req.body || {});
  if (!e.title) return bad(res, 'Please add the event name.');
  await query('UPDATE events SET title=?, starts_on=?, time_text=?, venue=?, description=?, is_past=? WHERE id=?', [e.title, e.starts_on, e.time_text, e.venue, e.description, e.is_past, idParam(req.params.id)]);
  res.json({ message: 'Saved.' });
});
r.delete('/events/:id', requireAdmin, async (req, res) => { await query('DELETE FROM events WHERE id = ?', [idParam(req.params.id)]); res.json({ message: 'Deleted.' }); });

/* ---------------- Gallery ---------------- */
r.get('/gallery', async (_req, res) => { res.json(await query('SELECT id, url, caption, category, created_at FROM gallery ORDER BY created_at DESC')); });
r.post('/gallery', requireAdmin, upload.array('photos', 10), async (req, res) => {
  const files = (req.files as Express.Multer.File[]) || [];
  if (!files.length) return bad(res, 'Please choose JPG, PNG or WEBP photos (up to 10 MB each).');
  const saved = [];
  for (const f of files) {
    const img = await saveImage(f);
    const caption = str(req.body?.caption) || f.originalname.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 120);
    const out: any = await query('INSERT INTO gallery (url, public_id, caption, category) VALUES (?,?,?,?)', [img.url, img.publicId, caption, 'photo']);
    saved.push({ id: out.insertId, url: img.url, caption });
  }
  res.status(201).json(saved);
});
r.put('/gallery/:id', requireAdmin, async (req, res) => { await query('UPDATE gallery SET caption = ? WHERE id = ?', [str(req.body?.caption), idParam(req.params.id)]); res.json({ message: 'Saved.' }); });
r.delete('/gallery/:id', requireAdmin, async (req, res) => {
  const id = idParam(req.params.id);
  const rows = await query<any[]>('SELECT public_id FROM gallery WHERE id = ?', [id]);
  if (rows[0]) await deleteImage(rows[0].public_id);
  await query('DELETE FROM gallery WHERE id = ?', [id]);
  res.json({ message: 'Deleted.' });
});

/* ---------------- Blog / devotionals ---------------- */
r.get('/posts', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '30'), 10) || 30, 1), 100);
  res.json(await query(`SELECT id, title, slug, excerpt, scripture, cover_url, published_at FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT ${limit}`));
});
r.get('/posts/:slug', async (req, res) => {
  const rows = await query<any[]>("SELECT * FROM posts WHERE slug = ? AND status = 'published'", [req.params.slug]);
  if (!rows[0]) return bad(res, 'That article could not be found.', 404);
  res.json(rows[0]);
});
r.get('/admin/posts', requireAdmin, async (_req, res) => { res.json(await query('SELECT * FROM posts ORDER BY updated_at DESC')); });
async function uniqueSlug(base: string, exceptId = 0) {
  let slug = slugify(base), n = 2;
  while ((await query<any[]>('SELECT id FROM posts WHERE slug = ? AND id <> ?', [slug, exceptId])).length) slug = `${slugify(base)}-${n++}`;
  return slug;
}
r.post('/posts', requireAdmin, upload.single('cover'), async (req, res) => {
  const b = req.body || {};
  const title = str(b.title), body = str(b.body, 200000);
  if (!title || !body) return bad(res, 'A title and the article text are required.');
  const status = b.status === 'published' ? 'published' : 'draft';
  const cover = req.file ? (await saveImage(req.file, 'apostle-joshua/blog')).url : str(b.cover_url, 500);
  const out: any = await query('INSERT INTO posts (title, slug, excerpt, body, scripture, cover_url, status, published_at) VALUES (?,?,?,?,?,?,?,?)',
    [title, await uniqueSlug(title), str(b.excerpt, 500) || body.replace(/\s+/g, ' ').slice(0, 220), body, str(b.scripture, 160), cover, status, status === 'published' ? new Date() : null]);
  res.status(201).json({ id: out.insertId });
});
r.put('/posts/:id', requireAdmin, upload.single('cover'), async (req, res) => {
  const id = idParam(req.params.id), b = req.body || {};
  const title = str(b.title), body = str(b.body, 200000);
  if (!title || !body) return bad(res, 'A title and the article text are required.');
  const prev = (await query<any[]>('SELECT * FROM posts WHERE id = ?', [id]))[0];
  if (!prev) return bad(res, 'Article not found.', 404);
  const status = b.status === 'published' ? 'published' : 'draft';
  const cover = req.file ? (await saveImage(req.file, 'apostle-joshua/blog')).url : (str(b.cover_url, 500) ?? prev.cover_url);
  const publishedAt = status === 'published' ? prev.published_at || new Date() : null;
  await query('UPDATE posts SET title=?, slug=?, excerpt=?, body=?, scripture=?, cover_url=?, status=?, published_at=? WHERE id=?',
    [title, prev.title === title ? prev.slug : await uniqueSlug(title, id), str(b.excerpt, 500) || body.replace(/\s+/g, ' ').slice(0, 220), body, str(b.scripture, 160), cover, status, publishedAt, id]);
  res.json({ message: 'Saved.' });
});
r.delete('/posts/:id', requireAdmin, async (req, res) => { await query('DELETE FROM posts WHERE id = ?', [idParam(req.params.id)]); res.json({ message: 'Deleted.' }); });

export default r;
