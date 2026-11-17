# Apostle Joshua Outreach — API

Express + TypeScript + MySQL (TiDB Cloud) backend for the Apostle Joshua Outreach website.

## What it does
- **Admin auth**: JWT login, forgot / reset password by email, change password, owner can add/remove team admins
- **Content**: sermons & videos (YouTube links), events, gallery photos (Cloudinary), devotionals (blog)
- **Inbox**: prayer requests and contact messages from the website (rate-limited, spam honeypot), with optional email alerts
- **Chat assistant**: answers visitors 24/7 from the site's own data and admin-written FAQs, with optional Google Gemini (free tier) for open questions. Takes prayer requests and enquiries inside the chat, hands over to WhatsApp, saves conversations for the admin, and emails alerts for urgent chats and new contacts
- **Automations**: email alerts to `NOTIFY_EMAIL`, thank-you emails to visitors, chat-to-inbox linking, 180-day chat cleanup
- **Site settings**: phone, WhatsApp, email, address, socials, story, giving details, live-stream switch
- Tables are created automatically on first start; the first admin is created from `ADMIN_EMAIL` + `ADMIN_TEMP_PASSWORD`.

## Run locally
```bash
cp .env.example .env    # fill in DB_* and ADMIN_* values
npm install
npm run dev             # http://localhost:5000/api/health
npm run build && npm run seed   # optional: load the YouTube videos and starter settings
```

## Deploy (Render)
1. Create a database in TiDB Cloud (e.g. `apostle_joshua`) and note host, user, password.
2. In Render: **New → Blueprint**, pick this repo. `render.yaml` sets everything up.
3. Fill in the secret values Render asks for (DB_HOST, DB_USER, DB_PASSWORD, ADMIN_EMAIL, ADMIN_TEMP_PASSWORD, and optionally CLOUDINARY_URL, BREVO_API_KEY and GEMINI_API_KEY).
4. After the first deploy, open the Render shell and run `npm run seed` once to load the videos.
5. Sign in at `/admin/login` on the website and change the temporary password.

> Render's disk is wiped on every deploy, so set `CLOUDINARY_URL` before uploading gallery photos.

## Scripts
| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with reload |
| `npm run build` / `npm start` | Production build / start |
| `npm run seed` | Load starter videos, events and settings (safe to re-run) |
| `npm run create-admin -- "Full Name" email password` | Create or reset an admin from the command line |
