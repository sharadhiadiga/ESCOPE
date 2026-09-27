import { redisConnection } from '../config/redis';

export interface RateLimitResult {
  allowed: boolean;
  reason?: 'HOURLY_LIMIT' | 'MIN_SPACING';
  retryAfterMs?: number;
}

const RESERVE_RATE_LIMIT_LUA = `
local hourly_count = tonumber(redis.call('GET', KEYS[1]) or '0')
local hourly_limit = tonumber(ARGV[1])
local min_delay = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local hourly_ttl = tonumber(ARGV[4])

if hourly_count >= hourly_limit then
  return { 0, "HOURLY_LIMIT", hourly_ttl * 1000 }
end

local last_sent = tonumber(redis.call('GET', KEYS[2]) or '0')
local elapsed = now_ms - last_sent

if elapsed < min_delay then
  local wait_ms = min_delay - elapsed
  return { 0, "MIN_SPACING", wait_ms }
end

redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], hourly_ttl)
redis.call('SET', KEYS[2], ARGV[3])

return { 1, "ALLOWED", 0 }
`;

export class RateLimiterService {
  /**
   * Atomically evaluates and reserves permission to send an email.
   * Ensures zero race conditions across multiple BullMQ workers.
   */
  static async reserveSendPermission(params: {
    campaignId: string;
    senderAccountId: string;
    hourlyLimit: number;
    delayBetweenEmailsMs: number;
  }): Promise<RateLimitResult> {
    const { campaignId, senderAccountId, hourlyLimit, delayBetweenEmailsMs } = params;
    const nowMs = Date.now();

    // Calculate current 1-hour window
    const hourWindowMs = 3600 * 1000;
    const currentWindowStart = Math.floor(nowMs / hourWindowMs) * hourWindowMs;
    const nextWindowStart = currentWindowStart + hourWindowMs;
    const hourlyTtlSeconds = Math.max(1, Math.ceil((nextWindowStart - nowMs) / 1000));

    const hourlyKey = `ratelimit:hourly:${campaignId}:${currentWindowStart}`;
    const spacingKey = `ratelimit:last_sent:${senderAccountId}`;

    const res = (await redisConnection.eval(
      RESERVE_RATE_LIMIT_LUA,
      2,
      hourlyKey,
      spacingKey,
      hourlyLimit.toString(),
      delayBetweenEmailsMs.toString(),
      nowMs.toString(),
      hourlyTtlSeconds.toString()
    )) as [number, string, number];

    const [allowedNum, reasonStr, retryAfterMs] = res;

    if (allowedNum === 1) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: reasonStr as 'HOURLY_LIMIT' | 'MIN_SPACING',
      retryAfterMs: Math.max(100, retryAfterMs), // Ensure minimum positive delay
    };
  }

  /**
   * Helper to reset rate limit state for a campaign/sender (useful in automated tests).
   */
  static async resetRateLimits(campaignId: string, senderAccountId: string) {
    const nowMs = Date.now();
    const hourWindowMs = 3600 * 1000;
    const currentWindowStart = Math.floor(nowMs / hourWindowMs) * hourWindowMs;
    const hourlyKey = `ratelimit:hourly:${campaignId}:${currentWindowStart}`;
    const spacingKey = `ratelimit:last_sent:${senderAccountId}`;
    const alertKey = `ratelimit:slack_alert:${campaignId}:${currentWindowStart}`;

    await redisConnection.del(hourlyKey, spacingKey, alertKey);
  }
}
