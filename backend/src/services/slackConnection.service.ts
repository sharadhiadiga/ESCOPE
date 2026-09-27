import { prisma } from '../db';
import { env } from '../config/env';

export interface SlackStatusResult {
  isConnected: boolean;
  teamName: string | null;
  channel: string | null;
}

export class SlackConnectionService {
  /**
   * Generates the real Slack OAuth v2 authorization URL with state for CSRF protection.
   */
  static generateAuthUrl(state: string): string {
    if (!env.SLACK_CLIENT_ID || !env.SLACK_REDIRECT_URI) {
      throw new Error('Slack OAuth is not configured. Missing SLACK_CLIENT_ID or SLACK_REDIRECT_URI.');
    }

    const scopes = ['chat:write', 'incoming-webhook'].join(',');
    const params = new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      scope: scopes,
      redirect_uri: env.SLACK_REDIRECT_URI,
      state,
    });

    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  }

  /**
   * Exchanges authorization code with Slack API for access tokens & webhook details,
   * then upserts the user's SlackConnection record in PostgreSQL.
   */
  static async exchangeCodeAndSave(code: string, userId: string) {
    if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET || !env.SLACK_REDIRECT_URI) {
      throw new Error('Slack OAuth configuration is incomplete on the server.');
    }

    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID,
        client_secret: env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: env.SLACK_REDIRECT_URI,
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      const errorMsg = data.error || 'Failed to exchange OAuth code with Slack API';
      console.error('[Slack Service] OAuth code exchange failed:', errorMsg);
      throw new Error(`Slack OAuth failed: ${errorMsg}`);
    }

    const slackUserId = data.authed_user?.id || data.user_id || null;
    const teamId = data.team?.id || null;
    const teamName = data.team?.name || null;
    const botAccessToken = data.access_token || null;
    const incomingWebhookUrl = data.incoming_webhook?.url || null;
    const channel = data.incoming_webhook?.channel || null;
    const channelId = data.incoming_webhook?.channel_id || null;

    return prisma.slackConnection.upsert({
      where: { userId },
      create: {
        userId,
        slackUserId,
        teamId,
        teamName,
        botAccessToken,
        incomingWebhookUrl,
        channel,
        channelId,
        isActive: true,
      },
      update: {
        slackUserId,
        teamId,
        teamName,
        botAccessToken,
        incomingWebhookUrl,
        channel,
        channelId,
        isActive: true,
      },
    });
  }

  /**
   * Returns a sanitized, safe connection status for API responses.
   * NEVER exposes access tokens or webhook URLs.
   */
  static async getConnectionStatus(userId: string): Promise<SlackStatusResult> {
    const conn = await prisma.slackConnection.findUnique({
      where: { userId },
    });

    if (!conn || !conn.isActive) {
      return {
        isConnected: false,
        teamName: null,
        channel: null,
      };
    }

    return {
      isConnected: true,
      teamName: conn.teamName,
      channel: conn.channel,
    };
  }

  /**
   * Internal lookup to retrieve credentials for background notification worker.
   */
  static async getCredentialsForUser(userId: string) {
    return prisma.slackConnection.findFirst({
      where: {
        userId,
        isActive: true,
      },
    });
  }

  /**
   * Deactivates the user's Slack connection.
   */
  static async disconnect(userId: string) {
    const conn = await prisma.slackConnection.findUnique({
      where: { userId },
    });

    if (!conn) return null;

    return prisma.slackConnection.update({
      where: { userId },
      data: { isActive: false },
    });
  }

  /**
   * Safely deactivates a revoked or invalidated connection.
   */
  static async deactivateRevokedConnection(userId: string) {
    console.warn(`[Slack Service] Deactivating revoked Slack connection for user ${userId}`);
    return prisma.slackConnection.updateMany({
      where: { userId },
      data: { isActive: false },
    });
  }
}
