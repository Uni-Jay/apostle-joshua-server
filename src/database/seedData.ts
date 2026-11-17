// The outreach's existing content (YouTube videos, events, contact details).
// Loaded automatically into a new, empty database on first start, and by `npm run seed`.
// Safe to run more than once: it skips anything that is already there.
import { query } from '../config/database';

const VIDEOS: [string, string, string, string, string][] = [
  // [youtube id, title, type, duration, approximate date]
  ['UjpwZnl-MtQ', 'Discovering Biblical Truth in a Generation of Myths', 'sermon', '52:18', '2026-10-17'],
  ['jghWGuRMTn0', 'Resurrection & Life', 'teaching', '0:54', '2026-10-27'],
  ['5hrJwgnxK00', 'Resurrection & Life (Clip 2)', 'teaching', '0:56', '2026-10-27'],
  ['sySpSgDPbLM', 'Discovering Biblical Truth in a Generation of Myths (Highlight)', 'teaching', '10:22', '2026-10-17'],
  ['QnpH11vYH18', '12 Hours With God: Making Disciples of All Nations', 'prayer', '1:20:22', '2026-10-17'],
  ['ruoE0IBivSM', '12 Hours With God: Making Disciples of All Nations (Session 2)', 'prayer', '58:06', '2026-05-17'],
  ['uLjP_RSjXUo', '12 Hours With God: Making Disciples of All Nations (Session 3)', 'prayer', '1:35:50', '2026-05-17'],
  ['6ixbMHOLpIM', '12 Hours With God: Making Disciples of All Nations (Session 4)', 'prayer', '2:23:00', '2026-05-17'],
  ['-6zD_w-2zYE', 'Apostle Joshua Outreach Live Stream', 'service', '1:12:15', '2026-05-17'],
  ['ANrwXgWbeas', 'Apostle Joshua Outreach Live Stream (Part 2)', 'service', '58:14', '2026-05-17'],
  ['3RJFB8V8XZw', 'Apostle Joshua Outreach Live Stream (Clip)', 'service', '1:59', '2026-05-17'],
  ['Vz_IhAH9DRQ', 'Apostle Joshua Outreach Live Stream (Clip 2)', 'service', '3:03', '2026-05-17'],
];

const SETTINGS: Record<string, string> = {
  phone: '+234 811 823 5172',
  whatsapp: '+234 907 605 2317',
  youtube_url: 'https://www.youtube.com/@apostlejoshua_outreach',
  facebook_url: 'https://www.facebook.com/profile.php?id=61576519587742',
  instagram_url: 'https://www.instagram.com/apostlejoshuaoutreach/',
  live_url: 'https://www.youtube.com/@apostlejoshua_outreach/streams',
  live_title: 'Apostle Joshua Outreach Live',
};

export async function seedContent(): Promise<number> {
  let added = 0;
  for (const [i, [yid, title, type, dur, date]] of VIDEOS.entries()) {
    const exists = await query<any[]>('SELECT id FROM sermons WHERE youtube_id = ?', [yid]);
    if (exists.length) continue;
    await query('INSERT INTO sermons (title, type, youtube_id, duration, preached_on, date_approx, featured) VALUES (?,?,?,?,?,1,?)', [title, type, yid, dur, date, i === 0 ? 1 : 0]);
    added++;
  }
  const ev = await query<any[]>('SELECT COUNT(*) AS n FROM events');
  if (!ev[0].n) {
    await query('INSERT INTO events (title, starts_on, venue, description) VALUES (?,?,?,?)', ['12 Hours Prayer Charge', '2027-05-01', 'Ikorodu, Lagos (venue to be announced)', 'Come ready to pray, seek God, receive strength and experience a deeper encounter with Him.']);
    await query('INSERT INTO events (title, starts_on, venue, description, is_past) VALUES (?,?,?,?,1)', ['Church, Culture and Christ Conference', null, 'Ikorodu, Lagos', 'Thank you to everyone who attended. We believe the teachings, fellowship and moments we shared will continue to produce lasting transformation in our lives, families and communities.']);
  }
  for (const [k, v] of Object.entries(SETTINGS)) {
    await query('INSERT IGNORE INTO settings (skey, svalue) VALUES (?, ?)', [k, v]);
  }
  return added;
}
