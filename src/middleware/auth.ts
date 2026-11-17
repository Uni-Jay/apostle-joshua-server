import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthUser { id: number; email: string; name: string; role: string }
export interface AuthRequest extends Request { user?: AuthUser }

export function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set (32+ characters) in production');
    return 'dev-only-secret-change-me-dev-only-secret';
  }
  return s;
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
