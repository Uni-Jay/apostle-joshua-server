import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export interface AuthUser { id: number; email: string; name: string; role: string }
export interface AuthRequest extends Request { user?: AuthUser }

let loadedSecret = '';
/** Called once at start-up (after the tables exist): uses JWT_SECRET if set, otherwise a random secret kept in the database. */
export async function loadJwtSecret(read: () => Promise<string | null>, write: (v: string) => Promise<void>): Promise<void> {
  const env = process.env.JWT_SECRET || '';
  if (env.length >= 32) { loadedSecret = env; return; }
  let v = await read();
  if (!v || v.length < 32) { v = crypto.randomBytes(48).toString('hex'); await write(v); }
  loadedSecret = v;
}
export function jwtSecret(): string {
  if (loadedSecret) return loadedSecret;
  throw new Error('Sign-in is not ready yet: the server is still starting.');
}

export function signToken(u: AuthUser): string {
  return jwt.sign(u, jwtSecret(), { expiresIn: '7d' });
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ message: 'Please sign in.' });
  try {
    const p = jwt.verify(token, jwtSecret()) as AuthUser;
    req.user = { id: p.id, email: p.email, name: p.name, role: p.role };
    next();
  } catch {
    return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
  }
}
