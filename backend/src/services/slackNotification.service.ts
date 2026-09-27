import { redisConnection } from '../config/redis';
import { SlackConnectionService } from './slackConnection.service';

export interface SlackAlertParams {
  userId: string;
  campaignId: string;
  campaignName: string;
  hourlyLimit: number;
  retryAfterMs?: number;
}

export class SlackNotificationService {
  /**
   * Sends a rate limit alert to the user's specific Slack workspace/channel if connected.
   * Deduplicated per campaign per 1-hour window using Redis.
   * Fully safe and non-blocking: errors or network/auth failures will never crash the email worker.
   */
  static async notifyRateLimitExceeded(params: SlackAlertParams): Promise<boolean> {
    try {
      const { userId, campaignId, campaignName, hourlyLimit } = params;
      const nowMs = Date.now();
      const hourWindowMs = 3600 * 1000;
      const currentWindowStart = Math.floor(nowMs / hourWindowMs) * hourWindowMs;
      const alertKey = `ratelimit:slack_alert:${campaignId}:${currentWindowStart}`;

      // 1. Deduplicate alert: SET key 1 EX 3600 NX
      const setSuccess = await redisConnection.set(alertKey, '1', 'EX', 3600, 'NX');
      if (!setSuccess) {
        // Alert already sent for this campaign in the current window
        return false;
      }

      // 2. Resolve active Slack Connection for this user
      const slackConn = await SlackConnectionService.getCredentialsForUser(userId);
      if (!slackConn || !slackConn.isActive) {
        console.log(`[Slack Notification] User ${userId} has no active Slack connection. Skipping alert.`);
        return false;
      }

      const messageText = `Email rate limit reached for campaign '${campaignName}'. The hourly limit of ${hourlyLimit} emails has been reached. Remaining emails have been rescheduled.`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      let response: Response;

      // 3. Prefer Webhook URL if available, else use Web API chat.postMessage with Bot Token
      if (slackConn.incomingWebhookUrl) {
        response = await fetch(slackConn.incomingWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: messageText }),
          signal: controller.signal,
        });
      } else if (slackConn.botAccessToken && (slackConn.channelId || slackConn.channel)) {
        response = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Bearer ${slackConn.botAccessToken}`,
          },
          body: JSON.stringify({
            channel: slackConn.channelId || slackConn.channel,
            text: messageText,
          }),
          signal: controller.signal,
        });
      } else {
        clearTimeout(timeoutId);
        console.warn(`[Slack Notification] User ${userId} Slack connection lacks webhook and bot token/channel.`);
        return false;
      }

      clearTimeout(timeoutId);

      // Handle revocation / authentication failure
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        console.warn(`[Slack Notification] Slack API returned ${response.status}. Deactivating revoked connection.`);
        await SlackConnectionService.deactivateRevokedConnection(userId);
        return false;
      }

      if (!response.ok) {
        console.warn(`[Slack Notification] HTTP Error ${response.status} when sending alert.`);
        return false;
      }

      const resData = await response.json().catch(() => ({ ok: true }));
      if (resData && resData.ok === false) {
        const errorMsg = resData.error || 'Slack API error';
        console.warn(`[Slack Notification] Slack API returned error: ${errorMsg}`);
        if (['token_revoked', 'account_inactive', 'invalid_auth', 'is_disabled'].includes(errorMsg)) {
          await SlackConnectionService.deactivateRevokedConnection(userId);
        }
        return false;
      }

      console.log(`[Slack Notification] ⚠️ Successfully posted tenant rate-limit alert for campaign ${campaignId}`);
      return true;
    } catch (err: any) {
      // Non-blocking catch-all: failure to send Slack alert must never break email processing
      console.warn(`[Slack Notification] Non-blocking alert error: ${err?.message || err}`);
      return false;
    }
  }
}
