import { Request, Response, NextFunction } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  googleId?: string | null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    return next();
  }
  return res.status(401).json({
    error: {
      message: 'Unauthorized: Authentication required',
    },
  });
}
