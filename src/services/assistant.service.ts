/**
 * Website chat assistant.
 *
 * 1. Safety first: messages that suggest someone is in danger get emergency guidance and an urgent alert.
 * 2. Clear requests (prayer, events, sermons, contact, invitations, giving, live...) are answered from the
 *    database, so the assistant works with no AI key at all and never invents dates or numbers.
 * 3. FAQs written by the admin are matched next.
 * 4. Anything else goes to Google Gemini (free tier) if GEMINI_API_KEY is set, grounded in the site's data.
 *    Without a key, or if the AI is busy, the visitor is offered WhatsApp or the contact form.
 *
 * Replies can carry an action the website turns into an inline form or button.
 */
import { query } from '../config/database';
import { readSettings } from '../routes/site.routes';

export type Action =
  | { type: 'prayer_form' }
  | { type: 'contact_form'; subject: string }
  | { type: 'whatsapp' }
  | { type: 'handoff' }
  | { type: 'call' };

export interface Reply { text: string; chips?: string[]; action?: Action; source: 'safety' | 'rule' | 'faq' | 'ai' | 'fallback'; urgent?: boolean }

const SUBJECTS = ['Planning a visit', 'I want to volunteer', 'Invite Apostle Joshua', 'Events', 'Partnership', 'General enquiry'];
const MAIN_CHIPS = ['Upcoming events', 'Send a prayer request', 'Watch a message', 'Invite Apostle Joshua', 'Talk to someone'];

/* ---------------- Site knowledge (cached briefly) ---------------- */
interface Ctx {
  s: Record<string, string>;
  events: { title: string; starts_on: string | null; time_text: string | null; venue: string | null; description: string | null }[];
  sermons: { title: string; type: string; youtube_id: string }[];
  faqs: { question: string; answer: string; keywords: string | null }[];
}
let cache: { at: number; ctx: Ctx } | null = null;
export function clearAssistantCache() { cache = null; }
async function context(): Promise<Ctx> {
  if (cache && Date.now() - cache.at < 60_000) return cache.ctx;
  const today = new Date().toISOString().slice(0, 10);
  const [s, events, sermons, faqs] = await Promise.all([
    readSettings(),
    query<any[]>('SELECT title, starts_on, time_text, venue, description FROM events WHERE is_past = 0 AND starts_on >= ? ORDER BY starts_on ASC LIMIT 5', [today]),
    query<any[]>('SELECT title, type, youtube_id FROM sermons ORDER BY featured DESC, preached_on DESC, id DESC LIMIT 6'),
    query<any[]>('SELECT question, answer, keywords FROM faqs WHERE active = 1 ORDER BY sort_order, id'),
  ]);
  const ctx = { s, events, sermons, faqs };
  cache = { at: Date.now(), ctx };
  return ctx;
}

const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const norm = (t: string) => ` ${t.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
const has = (t: string, words: string[]) => words.some((w) => t.includes(w.includes(' ') ? w : ` ${w}`));

/* ---------------- 1. Safety ---------------- */
const DANGER = [/su[i1]cid/, /kill (my ?self|me)/, /end (my|it all|my life)/, /want to die/, /don'?t want to (live|be alive)/, /self[\s-]?harm/, /hurt (my ?self)/, /cut(ting)? my ?self/,
  /\brap(e|ed|ing)\b/, /being abused/, /abus(e|ing) me/, /beat(s|ing)? me/, /in danger/, /threaten(ed|ing) (to kill|my life)/];
function safety(t: string, s: Record<string, string>): Reply | null {
  if (!DANGER.some((re) => re.test(t))) return null;
  const phone = s.phone ? ` You can also call Apostle Joshua's line on ${s.phone}.` : '';
  return {
    source: 'safety', urgent: true, action: { type: 'call' },
    text: `I'm really sorry you're going through this, and I'm glad you reached out. Your life matters to God and to us.\n\n**If you are in danger right now, please call 112** (Nigeria emergency line) or go to the nearest hospital, and tell someone near you that you need help.${phone}\n\nI've alerted our team so a person can reach out to you. If you'd like us to call or message you, share your phone number here.`,
  };
}

/* ---------------- 2. Clear requests ---------------- */
function eventsText(c: Ctx): string {
  if (!c.events.length) return `There are no upcoming dates announced yet. New programmes are posted on the [Events page](/events) and on our socials. Would you like us to let you know when the next one is announced?`;
  const lines = c.events.slice(0, 3).map((e) => `• **${e.title}**: ${e.starts_on ? fmtDay(e.starts_on) : 'date to be announced'}${e.time_text ? `, ${e.time_text}` : ''}${e.venue ? ` · ${e.venue}` : ''}`);
  return `Here's what's coming up:\n${lines.join('\n')}\n\nSee all details on the [Events page](/events).`;
}

function rules(t: string, c: Ctx): Reply | null {
  const s = c.s;
  const R = (text: string, extra: Partial<Reply> = {}): Reply => ({ text, source: 'rule', ...extra });

  if (/^ ?(hi|hello|hey|good (morning|afternoon|evening)|greetings|howdy|shalom|bless(ed)? (morning|day)|praise the lord|hy)( there| sir| ma| apostle)?[ !.]*$/.test(t))
    return R(`Hello, and welcome to Apostle Joshua Outreach! 🙌 How can I help you today?`, { chips: MAIN_CHIPS });

  if (has(t, ['talk to someone', 'talk to a person', 'human', 'real person', 'agent', 'customer care', 'speak with', 'speak to', 'chat on whatsapp', 'whatsapp me']))
    return R(`Of course. You can chat live with someone from our team right here, or continue on WhatsApp${s.whatsapp ? ` (${s.whatsapp})` : ''}.`, { action: { type: 'handoff' } });

  if (has(t, ['pray for', 'prayer request', 'need prayer', 'send a prayer', 'pray with me', 'intercede', 'prayers for']) || /^ ?(pray|prayer)s? ?$/.test(t))
    return R(`We would be honoured to pray with you. Fill in the short form below; Apostle Joshua and the prayer team read every request, and it stays private.`, { action: { type: 'prayer_form' } });

  if (has(t, ['invite', 'invitation', 'come and minister', 'minister at', 'preach at', 'speak at', 'book apostle', 'guest speaker']))
    return R(`Thank you for thinking of us! Share your programme details below (date, place, and what it's about) and the team will get back to you.`, { action: { type: 'contact_form', subject: 'Invite Apostle Joshua' } });

  if (has(t, ['volunteer', 'serve', 'join the team', 'join your team', 'help out', 'choir', 'protocol', 'media team', 'usher']))
    return R(`We'd love to have you serve with us. Leave your details below and tell us how you'd like to help (choir, protocol, media, or anything else).`, { action: { type: 'contact_form', subject: 'I want to volunteer' } });

  if (has(t, ['live', 'livestream', 'live stream', 'streaming', 'watch now']) && !has(t, ['where do you live', 'deliver']))
    return s.live_is_on === '1'
      ? R(`Yes, we're live right now${s.live_title ? `: **${s.live_title}**` : ''}! [Watch on the Live page](/live).`)
      : R(`We're not live at the moment. When we are, it shows on the [Live page](/live). Meanwhile, you can catch past messages on the [Sermons page](/sermons)${s.youtube_url ? ` or [our YouTube channel](${s.youtube_url})` : ''}.`);

  if (has(t, ['event', 'events', 'programme', 'program', 'crusade', 'conference', 'seminar', 'next meeting', 'upcoming', 'when is', 'schedule', 'service time', 'meeting time', 'gathering']))
    return R(eventsText(c) + (s.meeting_times ? `\n\nRegular gatherings: ${s.meeting_times}` : ''), { chips: ['Where is it held?', 'Send a prayer request', 'Talk to someone'] });

  if (has(t, ['sermon', 'message', 'teaching', 'video', 'watch', 'youtube', 'preach', 'listen', 'clip']) && !has(t, ['send a message', 'send message', 'message you', 'whatsapp'])) {
    const top = c.sermons.slice(0, 3).map((x) => `• [${x.title}](https://www.youtube.com/watch?v=${x.youtube_id})`).join('\n');
    return R(`${top ? `Here are some messages to start with:\n${top}\n\n` : ''}You'll find every teaching, prayer session and clip on the [Sermons page](/sermons).`);
  }

  if (has(t, ['where', 'address', 'location', 'located', 'direction', 'venue', 'map']))
    return R(s.address
      ? `We're based in **${s.address}**.${s.map_url ? ` [Open in Google Maps](${s.map_url})` : ''} Venues for each programme are listed on the [Events page](/events).`
      : `We're based in Ikorodu, Lagos. The venue for each programme is shared on the [Events page](/events). For directions, our team can help you on WhatsApp.`, { chips: ['Upcoming events', 'Talk to someone'] });

  if (has(t, ['phone', 'number', 'call', 'contact', 'reach you', 'email', 'whatsapp']))
    return R(`You can reach us here:\n${s.phone ? `• Call: **${s.phone}**\n` : ''}${s.whatsapp ? `• WhatsApp: **${s.whatsapp}**\n` : ''}${s.email ? `• Email: ${s.email}\n` : ''}• Or send a message on the [Contact page](/contact).`, { chips: ['Talk to someone', 'Send a prayer request'] });

  if (has(t, ['give', 'giving', 'donate', 'donation', 'offering', 'tithe', 'seed', 'partner', 'support the', 'sow', 'account number', 'bank']))
    return R(s.giving
      ? `Thank you for wanting to support the work! Partnership details are on the [Partner page](/give).`
      : `Thank you for wanting to support the work! Leave your details and the team will share how you can partner with us.`, s.giving ? {} : { action: { type: 'contact_form', subject: 'Partnership' } });

  if (has(t, ['vision', 'mission', 'what do you stand for', 'your goal', 'your purpose']))
    return R(`**Our vision:** to see lives across the nations transformed by Jesus Christ: people grounded in sound doctrine, strengthened by fervent prayer, and living in a way that reveals Christ wherever they are.\n\n**Our mission:** to reveal Christ to the nations through **Sound Doctrine**, **Fervent Prayer** and **Transformed Lives**. Read more on the [About page](/about).`, { chips: ['Upcoming events', 'Watch a message'] });

  if (has(t, ['who is apostle', 'about apostle', 'about you', 'about the outreach', 'who are you', 'what do you do', 'what is apostle joshua', 'tell me about']))
    return R(`Apostle Joshua Outreach is led by **Apostle Joshua A. Ogiriosa** and based in Ikorodu, Lagos. We teach sound apostolic doctrine (the New Testament message) and hold prayer meetings, crusades, seminars and conferences. Read more on the [About page](/about).`, { chips: ['Upcoming events', 'Watch a message'] });

  if (has(t, ['devotional', 'blog', 'article', 'read something']))
    return R(`You can read devotionals and teachings on the [Devotionals page](/blog).`);

  if (/^ ?(thanks?|thank you|thank u|thx|god bless( you)?|amen|ok(ay)?|alright|bye|goodbye)[ !.]*$/.test(t))
    return R(`God bless you! 🙏 I'm here if you need anything else.`, { chips: MAIN_CHIPS });

  return null;
}

/* ---------------- 3. FAQs ---------------- */
function faqMatch(t: string, c: Ctx): Reply | null {
  let best: { score: number; a: string } | null = null;
  for (const f of c.faqs) {
    const kws = (f.keywords || '').split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
    let score = kws.reduce((n, k) => n + (t.includes(` ${k}`) ? (k.includes(' ') ? 2 : 1) : 0), 0);
    if (norm(f.question).trim() === t.trim()) score += 5;
    if (score > 0 && (!best || score > best.score)) best = { score, a: f.answer };
  }
  if (!best) return null;
  let action: Action | undefined;
  if (/invite|invitation/i.test(best.a)) action = { type: 'contact_form', subject: 'Invite Apostle Joshua' };
  return { text: best.a, source: 'faq', action, chips: action ? [] : ['Send a prayer request', 'Upcoming events', 'Talk to someone'] };
}

/* ---------------- 4. AI (Gemini free tier) ---------------- */
export const aiConfigured = () => !!process.env.GEMINI_API_KEY;
export const aiModel = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

function systemPrompt(c: Ctx, botName: string): string {
  const s = c.s;
  const ev = c.events.map((e) => `- ${e.title} | ${e.starts_on ? fmtDay(e.starts_on) : 'date TBA'}${e.time_text ? ` ${e.time_text}` : ''}${e.venue ? ` | ${e.venue}` : ''}${e.description ? ` | ${e.description.slice(0, 200)}` : ''}`).join('\n') || '(none announced)';
  const ser = c.sermons.map((x) => `- ${x.title} (https://www.youtube.com/watch?v=${x.youtube_id})`).join('\n');
  const faq = c.faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n');
  return `You are "${botName}", the friendly assistant on the website of Apostle Joshua Outreach in Ikorodu, Lagos, Nigeria.
It is led by Apostle Joshua A. Ogiriosa (often called Apostle Joshua). It is an OUTREACH, not a church: it teaches sound apostolic doctrine (the New Testament message) and holds prayer meetings, crusades, seminars and conferences. Vision: lives across the nations transformed by Jesus Christ, grounded in sound doctrine, strengthened by fervent prayer, living in a way that reveals Christ. Mission: to reveal Christ to the nations through Sound Doctrine (Acts 2:42), Fervent Prayer (James 5:16) and Transformed Lives (Romans 12:2). Its vision also includes helping people find jobs and supporting the needy in future, as funds allow.

Style: warm, respectful, brief (2-5 short sentences), simple English that Nigerian visitors will find natural. Use **bold** sparingly and markdown links like [Events page](/events). Never use headings.

Rules:
- Only state facts found below. If you don't know (dates, venues, prices, people, policies), say so and offer WhatsApp or the contact form. Never invent events, numbers or bank details.
- For Bible questions you may answer briefly with a scripture reference, in line with New Testament teaching, and invite them to watch the teachings. Don't argue about denominations or criticise other churches or people.
- Never give medical, legal or financial advice; encourage them to see a professional and offer prayer.
- If someone may be in danger or wants to harm themselves, tell them to call 112 (Nigeria emergency) immediately and add [[CALL]].
- Don't claim to be Apostle Joshua or a human. Don't promise miracles, outcomes, or that Apostle Joshua personally will call.
- To show a form or button, end your reply with ONE tag: [[PRAYER_FORM]] (they want prayer), [[CONTACT:Invite Apostle Joshua]], [[CONTACT:I want to volunteer]], [[CONTACT:Partnership]], [[CONTACT:Planning a visit]], [[CONTACT:General enquiry]], or [[HANDOFF]] (they want to talk to a person).

Site pages: / (home), /about, /sermons, /live, /events, /gallery, /blog (devotionals), /prayer, /give (partner), /contact.
Contact: phone ${s.phone || 'n/a'}; WhatsApp ${s.whatsapp || 'n/a'}; email ${s.email || 'n/a'}; base ${s.address || 'Ikorodu, Lagos'}.
Regular gatherings: ${s.meeting_times || 'not listed'}. Live now: ${s.live_is_on === '1' ? `yes (${s.live_title || 'see /live'})` : 'no'}.
About Apostle Joshua: ${(s.story || 'not provided').slice(0, 1500)}
Partnership: ${s.giving ? 'details are on /give' : 'ask them to leave details via [[CONTACT:Partnership]]'}.
Upcoming events:
${ev}
Recent messages:
${ser}
FAQs:
${faq}
Today is ${fmtDay(new Date().toISOString().slice(0, 10))}.`;
}

async function askAI(c: Ctx, botName: string, history: { role: string; text: string }[]): Promise<Reply | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const contents = history.slice(-10).map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(aiModel())}:generateContent`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(c, botName) }] },
        contents,
        generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
        safetySettings: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']
          .map((category) => ({ category, threshold: 'BLOCK_MEDIUM_AND_ABOVE' })),
      }),
    });
    if (!r.ok) { console.error('Gemini error', r.status, (await r.text()).slice(0, 300)); return null; }
    const data: any = await r.json();
    let text: string = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim();
    if (!text) return null;
    let action: Action | undefined;
    const tag = text.match(/\[\[(PRAYER_FORM|WHATSAPP|HANDOFF|CALL|CONTACT:([^\]]+))\]\]/);
    if (tag) {
      if (tag[1] === 'PRAYER_FORM') action = { type: 'prayer_form' };
      else if (tag[1] === 'WHATSAPP' || tag[1] === 'HANDOFF') action = { type: 'handoff' };
      else if (tag[1] === 'CALL') action = { type: 'call' };
      else action = { type: 'contact_form', subject: SUBJECTS.includes((tag[2] || '').trim()) ? tag[2].trim() : 'General enquiry' };
    }
    text = text.replace(/\[\[[^\]]*\]\]/g, '').trim();
    return { text, action, source: 'ai' };
  } catch (e: any) {
    console.error('Gemini request failed', e?.name || e);
    return null;
  } finally { clearTimeout(timer); }
}

/* ---------------- Entry point ---------------- */
/** Used in live-chat mode: only the safety reply runs, so a person in danger still gets help at once. */
export async function safetyOnly(message: string): Promise<Reply | null> {
  const c = await context();
  return safety(norm(message), c.s);
}

export async function answer(message: string, history: { role: string; text: string }[]): Promise<Reply> {
  const c = await context();
  const t = norm(message);
  const botName = c.s.bot_name || 'Outreach Assistant';
  const shared = /(\+?234|\b0)[\s-]?[789][01]\d[\s-]?\d{3}[\s-]?\d{4}/.test(message) || /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(message);
  const contactReply: Reply | null = shared && message.replace(/[^a-z]/gi, '').length < 60
    ? { source: 'rule', text: `Thank you! I've passed your details to the team and someone will reach out to you. Is there anything you'd like us to pray about or help with in the meantime?`, chips: ['Send a prayer request', 'Upcoming events'] }
    : null;
  return safety(t, c.s)
    || contactReply
    || rules(t, c)
    || faqMatch(t, c)
    || (await askAI(c, botName, history))
    || {
      source: 'fallback', chips: MAIN_CHIPS, action: { type: 'handoff' },
      text: `I'm not sure I have the answer to that, but our team can help. Chat live with someone here, message them on WhatsApp${c.s.whatsapp ? ` (${c.s.whatsapp})` : ''}, or pick one of the options below.`,
    };
}

export async function greeting() {
  const c = await context();
  return {
    enabled: c.s.bot_enabled !== '0',
    name: c.s.bot_name || 'Outreach Assistant',
    greeting: c.s.bot_greeting || 'Hello, and welcome! 🙌 I can tell you about upcoming events, share a message to watch, take your prayer request, or connect you with our team. How can I help?',
    chips: MAIN_CHIPS,
    whatsapp: c.s.whatsapp, phone: c.s.phone,
  };
}
