import { redisConnection } from '../config/redis';
import { env } from '../config/env';

export interface SlackAlertParams {
  campaignId: string;
  campaignName: string;
  hourlyLimit: number;
}

export class SlackNotificationService {
  /**
   * Sends an hourly rate limit notification to Slack if configured.
   * Deduplicated per campaign per hourly window using Redis.
   * Safe and non-blocking: errors or network failures will never throw or break email delivery.
   */
  static async notifyRateLimitExceeded(params: SlackAlertParams): Promise<boolean> {
    try {
      const webhookUrl = env.SLACK_WEBHOOK_URL;
      if (!webhookUrl || !webhookUrl.trim()) {
        // Slack notification not configured - skip quietly
        return false;
      }

      const { campaignId, campaignName, hourlyLimit } = params;
      const nowMs = Date.now();
      const hourWindowMs = 3600 * 1000;
      const currentWindowStart = Math.floor(nowMs / hourWindowMs) * hourWindowMs;
      const alertKey = `ratelimit:slack_alert:${campaignId}:${currentWindowStart}`;

      // Deduplicate alert: SET key 1 EX 3600 NX
      const setSuccess = await redisConnection.set(alertKey, '1', 'EX', 3600, 'NX');
      if (!setSuccess) {
        // Alert already sent for this campaign in the current window
        return false;
      }

      const payload = {
        text: `⚠️ *Hourly Rate Limit Reached*\nCampaign "*${campaignName}*" hit its hourly limit of ${hourlyLimit} emails/hour. Remaining scheduled emails have been queued/rescheduled for the next window.`,
      };

      // Perform non-blocking fetch with 5 second timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`[Slack Notification] Non-OK status when sending alert: ${response.status}`);
        return false;
      }

      console.log(`[Slack Notification] ⚠️ Successfully posted rate-limit alert for campaign ${campaignId}`);
      return true;
    } catch (err: any) {
      // Non-blocking error handler: failure to send Slack notification must never break email processing
      console.warn(`[Slack Notification] Failed to send alert (non-blocking): ${err?.message || err}`);
      return false;
    }
  }
}
