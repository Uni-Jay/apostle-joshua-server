// Sends email through Resend (what HOCFAM uses) or Brevo, whichever key is set.
// With neither, the message is written to the log instead, so local development still works.
const real = (v?: string) => (v && v.trim().length >= 10 ? v.trim() : '');

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const recipients = to.split(',').map((e) => e.trim()).filter(Boolean);
  const fromName = process.env.EMAIL_FROM_NAME || 'Apostle Joshua Outreach';
  const resend = real(process.env.RESEND_API_KEY), brevo = real(process.env.BREVO_API_KEY);
  try {
    if (resend) {
      // RESEND_FROM may be "Name <address>" or just an address; we always show the outreach's name.
      const raw = process.env.RESEND_FROM || process.env.EMAIL_FROM || 'onboarding@resend.dev';
      const addr = (raw.match(/<([^>]+)>/)?.[1] || raw).trim();
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resend}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: `${fromName} <${addr}>`, to: recipients, subject, html }),
      });
      if (!r.ok) console.error('Resend error', r.status, await r.text());
      return r.ok;
    }
    if (brevo) {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': brevo, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { email: process.env.EMAIL_FROM || 'no-reply@apostlejoshuaoutreach.org', name: fromName }, to: recipients.map((email) => ({ email })), subject, htmlContent: html }),
      });
      if (!r.ok) console.error('Brevo error', r.status, await r.text());
      return r.ok;
    }
    console.log(`[email not sent: no RESEND_API_KEY or BREVO_API_KEY] To: ${to} | ${subject}\n${html}`);
    return false;
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
