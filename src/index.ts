import 'express-async-errors';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { initDatabase } from './database/init';
import { UPLOAD_DIR } from './services/media.service';
import { jwtSecret } from './middleware/auth';
import authRoutes from './routes/auth.routes';
import contentRoutes from './routes/content.routes';
import inboxRoutes from './routes/inbox.routes';
import siteRoutes from './routes/site.routes';

dotenv.config();
jwtSecret(); // fail fast in production if the secret is missing

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy; needed for rate limiting by visitor IP

const allowed = (process.env.CLIENT_URLS || process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => (!origin || allowed.includes(origin.replace(/\/$/, '')) ? cb(null, true) : cb(new Error('Not allowed by CORS'))),
}));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'tiny' : 'dev'));
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

app.get('/', (_req, res) => res.json({ name: 'Apostle Joshua Outreach API', status: 'ok' }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use('/api/auth', authRoutes);
app.use('/api', contentRoutes);
app.use('/api', inboxRoutes);
app.use('/api', siteRoutes);

app.use((_req, res) => res.status(404).json({ message: 'Not found.' }));
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.message === 'Not allowed by CORS') return res.status(403).json({ message: 'This website is not allowed to use the API.' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: 'That photo is too large (10 MB maximum).' });
  console.error(err);
  res.status(500).json({ message: 'Something went wrong on our side. Please try again.' });
});

const PORT = Number(process.env.PORT) || 5000;
initDatabase()
  .then(() => app.listen(PORT, () => console.log(`Apostle Joshua Outreach API running on port ${PORT}`)))
  .catch((e) => { console.error('Database setup failed:', e.message); process.exit(1); });

export default app;
