import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { requireAuth, AuthenticatedUser } from '../middleware/auth';
import { SlackConnectionService } from '../services/slackConnection.service';
import { env } from '../config/env';

const router = Router();

// 1. GET /api/slack/connect - Initiate Slack OAuth Flow
router.get('/connect', requireAuth, (req: Request, res: Response) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    (req.session as any).slackAuthState = state;

    const authUrl = SlackConnectionService.generateAuthUrl(state);
    return res.redirect(authUrl);
  } catch (err: any) {
    console.error('[Slack Routes] Failed to initiate OAuth:', err.message);
    return res.status(500).json({ error: { message: err.message || 'Failed to initiate Slack OAuth' } });
  }
});

// 2. GET /api/slack/callback - Handle Slack OAuth Callback
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    console.warn('[Slack Routes] User or Slack cancelled authorization:', error);
    return res.redirect(`${env.FRONTEND_URL}/dashboard?slack=cancelled`);
  }

  const savedState = (req.session as any)?.slackAuthState;
  if (!state || !savedState || state !== savedState) {
    console.warn('[Slack Routes] CSRF state mismatch during OAuth callback');
    return res.redirect(`${env.FRONTEND_URL}/dashboard?slack=error&message=invalid_state`);
  }

  delete (req.session as any).slackAuthState;

  const user = req.user as AuthenticatedUser;
  if (!user || !user.id) {
    console.warn('[Slack Routes] Session expired during OAuth callback');
    return res.redirect(`${env.FRONTEND_URL}/login?error=session_expired`);
  }

  if (!code || typeof code !== 'string') {
    return res.redirect(`${env.FRONTEND_URL}/dashboard?slack=error&message=missing_code`);
  }

  try {
    await SlackConnectionService.exchangeCodeAndSave(code, user.id);
    return res.redirect(`${env.FRONTEND_URL}/dashboard?slack=success`);
  } catch (err: any) {
    const errorMsg = err?.message ? encodeURIComponent(err.message) : 'oauth_failed';
    return res.redirect(`${env.FRONTEND_URL}/dashboard?slack=error&message=${errorMsg}`);
  }
});

// 3. GET /api/slack/status - Retrieve Sanitized Connection Status
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user as AuthenticatedUser;
    const status = await SlackConnectionService.getConnectionStatus(user.id);
    return res.status(200).json(status);
  } catch (err: any) {
    console.error('[Slack Routes] Error fetching status:', err.message);
    return res.status(500).json({ error: { message: 'Failed to fetch Slack status' } });
  }
});

// 4. POST /api/slack/disconnect - Deactivate Slack Integration
router.post('/disconnect', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user as AuthenticatedUser;
    await SlackConnectionService.disconnect(user.id);
    return res.status(200).json({ status: 'ok', isConnected: false });
  } catch (err: any) {
    console.error('[Slack Routes] Error during disconnect:', err.message);
    return res.status(500).json({ error: { message: 'Failed to disconnect Slack' } });
  }
});

export default router;
