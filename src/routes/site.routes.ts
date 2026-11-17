import { Router } from 'express';
import { query } from '../config/database';
import { requireAdmin } from '../middleware/auth';
import { youtubeId } from '../utils/helpers';

const r = Router();

// Everything the public pages need about the outreach, editable from the dashboard.
export const SETTING_KEYS = [
  'address', 'map_url', 'meeting_times', 'phone', 'whatsapp', 'email', 'story', 'giving',
  'youtube_url', 'facebook_url', 'instagram_url',
  'live_is_on', 'live_url', 'live_title',
];

async function readSettings(): Promise<Record<string, string>> {
  const rows = await query<any[]>('SELECT skey, svalue FROM settings');
  const out: Record<string, string> = {};
  SETTING_KEYS.forEach((k) => (out[k] = ''));
  rows.forEach((r) => { if (SETTING_KEYS.includes(r.skey)) out[r.skey] = r.svalue || ''; });
  return out;
}

r.get('/settings', async (_req, res) => {
  const s = await readSettings();
  res.json({ ...s, live_is_on: s.live_is_on === '1', live_video_id: youtubeId(s.live_url) });
});

r.put('/settings', requireAdmin, async (req, res) => {
  const b = req.body || {};
  for (const k of SETTING_KEYS) {
    if (!(k in b)) continue;
    let v = b[k];
    if (k === 'live_is_on') v = v === true || v === '1' || v === 'true' ? '1' : '0';
    v = v === null || v === undefined ? '' : String(v).slice(0, k === 'story' ? 8000 : 2000).trim();
    await query('INSERT INTO settings (skey, svalue) VALUES (?, ?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)', [k, v]);
  }
  res.json({ message: 'Settings saved.' });
});

r.get('/dashboard', requireAdmin, async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const [[sermons], [events], [photos], [posts], [prayers], [msgs]] = await Promise.all([
    query<any[]>('SELECT COUNT(*) AS n FROM sermons'),
    query<any[]>('SELECT COUNT(*) AS n, MIN(starts_on) AS next_on FROM events WHERE is_past = 0 AND starts_on >= ?', [today]),
    query<any[]>('SELECT COUNT(*) AS n FROM gallery'),
    query<any[]>("SELECT SUM(status='published') AS published, SUM(status='draft') AS drafts FROM posts"),
    query<any[]>("SELECT SUM(status='new') AS fresh, COUNT(*) AS n FROM prayer_requests"),
    query<any[]>("SELECT SUM(status='new') AS fresh, COUNT(*) AS n FROM messages"),
  ]);
  const settings = await readSettings();
  const missing = ['address', 'meeting_times', 'phone', 'email', 'story'].filter((k) => !settings[k]);
  const recentPrayers = await query('SELECT id, name, request, status, created_at FROM prayer_requests ORDER BY created_at DESC LIMIT 5');
  const recentSermons = await query('SELECT id, title, type, youtube_id, preached_on, date_approx FROM sermons ORDER BY created_at DESC LIMIT 5');
  res.json({
    counts: {
      sermons: sermons.n, upcomingEvents: events.n, nextEventOn: events.next_on, photos: photos.n,
      postsPublished: Number(posts.published || 0), postsDraft: Number(posts.drafts || 0),
      prayersNew: Number(prayers.fresh || 0), prayersTotal: prayers.n, messagesNew: Number(msgs.fresh || 0), messagesTotal: msgs.n,
    },
    missing, recentPrayers, recentSermons,
  });
});

export default r;
