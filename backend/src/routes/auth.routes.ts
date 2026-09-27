import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { env } from '../config/env';
import { requireAuth, AuthenticatedUser } from '../middleware/auth';

const router = Router();

// 1. GET /auth/google - Initiate Google OAuth
router.get('/google', (req: Request, res: Response, next: NextFunction) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({
      error: {
        message: 'Google OAuth is not configured. Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in environment variables.',
      },
    });
  }
  passport.authenticate('google', {
    scope: ['openid', 'email', 'profile'],
  })(req, res, next);
});

// 2. GET /auth/google/callback - Handle Google OAuth Callback
router.get(
  '/google/callback',
  (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate('google', (err: any, user: any) => {
      if (err || !user) {
        const errorMsg = err?.message ? encodeURIComponent(err.message) : 'authentication_failed';
        return res.redirect(`${env.FRONTEND_URL}/login?error=${errorMsg}`);
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          return res.redirect(`${env.FRONTEND_URL}/login?error=session_error`);
        }
        return res.redirect(`${env.FRONTEND_URL}/dashboard`);
      });
    })(req, res, next);
  }
);

// 3. GET /auth/me - Return Currently Authenticated User
router.get('/me', requireAuth, (req: Request, res: Response) => {
  const user = req.user as AuthenticatedUser;
  return res.status(200).json({
    id: user.id,
    email: user.email,
    name: user.name || null,
    avatarUrl: user.avatarUrl || null,
  });
});

// 4. POST /auth/logout - Terminate Session
router.post('/logout', (req: Request, res: Response) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.clearCookie('connect.sid');
    return res.status(200).json({ status: 'ok', message: 'Already logged out' });
  }

  req.logout((err) => {
    if (err) {
      console.error('Error during logout:', err);
    }
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      return res.status(200).json({ status: 'ok', message: 'Logged out successfully' });
    });
  });
});

export default router;
