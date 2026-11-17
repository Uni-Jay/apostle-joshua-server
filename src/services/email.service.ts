// Sends email through Brevo's HTTP API (the same provider HOCFAM uses).
// Without BREVO_API_KEY the message is written to the log instead, so local development still works.
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.BREVO_API_KEY;
  const fromEmail = process.env.EMAIL_FROM || 'no-reply@apostlejoshuaoutreach.org';
  const fromName = process.env.EMAIL_FROM_NAME || 'Apostle Joshua Outreach';
  if (!key) {
    console.log(`[email not sent: BREVO_API_KEY missing] To: ${to} | ${subject}\n${html}`);
    return false;
  }
  try {
    const r = await fetch(BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { email: fromEmail, name: fromName }, to: [{ email: to }], subject, htmlContent: html }),
    });
    if (!r.ok) console.error('Brevo error', r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error('Email failed', e);
    return false;
  }
}

export function wrap(title: string, body: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e5e0d0;border-radius:12px;overflow:hidden">
  <div style="background:#0A0640;color:#F4C95D;padding:18px 22px;font-weight:bold;letter-spacing:2px">APOSTLE JOSHUA OUTREACH</div>
  <div style="padding:22px;color:#17123F;line-height:1.6"><h2 style="margin-top:0">${title}</h2>${body}</div></div>`;
}

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
