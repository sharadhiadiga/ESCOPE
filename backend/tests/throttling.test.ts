process.env.NODE_ENV = 'test';
import { prisma, EmailStatus, DeliveryEventType, CampaignStatus } from '../src/db';
import { RateLimiterService } from '../src/services/rateLimiter.service';
import { SlackNotificationService } from '../src/services/slackNotification.service';
import { EmailDeliveryService } from '../src/services/emailDelivery.service';
import { EmailSchedulingService } from '../src/services/emailScheduling.service';
import { createEmailWorker } from '../src/workers/email.worker';
import { redisConnection } from '../src/config/redis';
import { UserService } from '../src/services/user.service';
import { EmailAccountService } from '../src/services/emailAccount.service';

async function runThrottlingTests() {
  console.log('🧪 Starting Phase 6 Email Throttling & Rate Limiting Tests...\n');
  let passedCount = 0;
  let totalCount = 0;

  async function test(description: string, fn: () => Promise<void>) {
    totalCount++;
    try {
      await fn();
      console.log(`  ✅ PASS: ${description}`);
      passedCount++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${description}`);
      console.error(`     Error: ${err.message || err}`);
    }
  }

  const testRunId = Date.now();
  let testUser: any;
  let testAccount: any;
  let testCampaign: any;
  let worker: any;

  // Mock EmailDeliveryService for tests
  const originalSendEmail = EmailDeliveryService.sendEmail;
  EmailDeliveryService.sendEmail = async (payload) => ({
    success: true,
    messageId: `mock_throttling_msg_${Date.now()}`,
    accepted: [payload.to],
    rejected: [],
    previewUrl: 'https://ethereal.email/message/mock',
  });

  try {
    testUser = await UserService.createUser({
      email: `throttling_user_${testRunId}@example.com`,
      name: 'Throttling Tester',
    });

    testAccount = await EmailAccountService.createEmailAccount({
      userId: testUser.id,
      email: `sender_${testRunId}@ethereal.email`,
      displayName: 'Throttling Sender',
      smtpHost: 'smtp.ethereal.email',
      smtpPort: 587,
      smtpUser: 'ethereal_user',
      smtpPassword: 'secret_password',
      provider: 'ethereal',
    });

    testCampaign = await prisma.campaign.create({
      data: {
        userId: testUser.id,
        senderAccountId: testAccount.id,
        name: 'Throttling Test Campaign',
        subject: 'Rate Limit Subject',
        body: 'Body text',
        startAt: new Date(),
        delayBetweenEmailsMs: 2000,
        hourlyLimit: 2,
        status: CampaignStatus.SCHEDULED,
      },
    });

    // Reset rate limits before beginning tests
    await RateLimiterService.resetRateLimits(testCampaign.id, testAccount.id);

    // 1. Minimum delay enforcement
    await test('1. RateLimiterService enforces minimum delay between sends', async () => {
      const res1 = await RateLimiterService.reserveSendPermission({
        campaignId: testCampaign.id,
        senderAccountId: testAccount.id,
        hourlyLimit: 10,
        delayBetweenEmailsMs: 2000,
      });
      if (!res1.allowed) throw new Error('Expected 1st reservation to be allowed');

      const res2 = await RateLimiterService.reserveSendPermission({
        campaignId: testCampaign.id,
        senderAccountId: testAccount.id,
        hourlyLimit: 10,
        delayBetweenEmailsMs: 2000,
      });
      if (res2.allowed || res2.reason !== 'MIN_SPACING') {
        throw new Error(`Expected MIN_SPACING rejection, got ${res2.reason}`);
      }
      if (!res2.retryAfterMs || res2.retryAfterMs <= 0) {
        throw new Error('Expected positive retryAfterMs value');
      }
    });

    // Reset rate limits for next test
    await RateLimiterService.resetRateLimits(testCampaign.id, testAccount.id);

    // 2. Hourly limit enforcement
    await test('2. RateLimiterService enforces hourly limit and does not consume spacing on hourly block', async () => {
      const res1 = await RateLimiterService.reserveSendPermission({
        campaignId: testCampaign.id,
        senderAccountId: testAccount.id,
        hourlyLimit: 2,
        delayBetweenEmailsMs: 0,
      });
      if (!res1.allowed) throw new Error('Expected 1st reservation to be allowed');

      const res2 = await RateLimiterService.reserveSendPermission({
        campaignId: testCampaign.id,
        senderAccountId: testAccount.id,
        hourlyLimit: 2,
        delayBetweenEmailsMs: 0,
      });
      if (!res2.allowed) throw new Error('Expected 2nd reservation to be allowed');

      const res3 = await RateLimiterService.reserveSendPermission({
        campaignId: testCampaign.id,
        senderAccountId: testAccount.id,
        hourlyLimit: 2,
        delayBetweenEmailsMs: 0,
      });
      if (res3.allowed || res3.reason !== 'HOURLY_LIMIT') {
        throw new Error(`Expected HOURLY_LIMIT rejection, got ${res3.reason}`);
      }
    });

    // Reset rate limits
    await RateLimiterService.resetRateLimits(testCampaign.id, testAccount.id);

    // 3. Concurrent workers race condition protection
    await test('3. Atomic reservation prevents race conditions with concurrent workers', async () => {
      const promises = Array.from({ length: 5 }).map(() =>
        RateLimiterService.reserveSendPermission({
          campaignId: testCampaign.id,
          senderAccountId: testAccount.id,
          hourlyLimit: 2,
          delayBetweenEmailsMs: 0,
        })
      );

      const results = await Promise.all(promises);
      const allowedCount = results.filter((r) => r.allowed).length;
      const deniedCount = results.filter((r) => !r.allowed).length;

      if (allowedCount !== 2 || deniedCount !== 3) {
        throw new Error(`Expected 2 allowed and 3 denied, got ${allowedCount} allowed and ${deniedCount} denied`);
      }
    });

    // Reset rate limits
    await RateLimiterService.resetRateLimits(testCampaign.id, testAccount.id);

    // 4. Redis state survives service/worker recreation
    await test('4. Redis rate limit keys persist correctly in Redis across service/worker recreation', async () => {
      await RateLimiterService.reserveSendPermission({
        campaignId: testCampaign.id,
        senderAccountId: testAccount.id,
        hourlyLimit: 5,
        delayBetweenEmailsMs: 5000,
      });

      const nowMs = Date.now();
      const currentWindowStart = Math.floor(nowMs / 3600000) * 3600000;
      const hourlyKey = `ratelimit:hourly:${testCampaign.id}:${currentWindowStart}`;
      const spacingKey = `ratelimit:last_sent:${testAccount.id}`;

      const count = await redisConnection.get(hourlyKey);
      const lastSent = await redisConnection.get(spacingKey);

      if (count !== '1' || !lastSent) {
        throw new Error(`Expected Redis count=1 and lastSent set, got count=${count}, lastSent=${lastSent}`);
      }
    });

    // 5. Slack unconfigured webhook safety
    await test('5. SlackNotificationService handles missing configuration without throwing', async () => {
      const result = await SlackNotificationService.notifyRateLimitExceeded({
        campaignId: testCampaign.id,
        campaignName: 'Test Campaign',
        hourlyLimit: 200,
      });
      if (result !== false) {
        throw new Error('Expected notifyRateLimitExceeded to return false when unconfigured');
      }
    });

    // 6. Slack HTTP network failure handling
    await test('6. SlackNotificationService handles HTTP network failures gracefully', async () => {
      const originalFetch = global.fetch;
      global.fetch = (async () => {
        throw new Error('Network error connecting to Slack');
      }) as any;

      try {
        const result = await SlackNotificationService.notifyRateLimitExceeded({
          campaignId: testCampaign.id,
          campaignName: 'Test Campaign',
          hourlyLimit: 200,
        });

        if (result !== false) {
          throw new Error('Expected notifyRateLimitExceeded to return false on network failure');
        }
      } finally {
        global.fetch = originalFetch;
      }
    });

    // 7. Worker rate limiting & job rescheduling integration
    await test('7. Worker reschedules email when hourly limit is reached and creates RESCHEDULED DeliveryLog', async () => {
      // Configure campaign with limit=1, delay=0
      await prisma.campaign.update({
        where: { id: testCampaign.id },
        data: { hourlyLimit: 1, delayBetweenEmailsMs: 0 },
      });
      await RateLimiterService.resetRateLimits(testCampaign.id, testAccount.id);

      // Reserve 1 slot so limit is reached
      await RateLimiterService.reserveSendPermission({
        campaignId: testCampaign.id,
        senderAccountId: testAccount.id,
        hourlyLimit: 1,
        delayBetweenEmailsMs: 0,
      });

      // Schedule email
      const scheduled = await EmailSchedulingService.scheduleEmail(testUser.id, {
        campaignId: testCampaign.id,
        recipientEmail: 'reschedule_test@example.com',
        subject: 'Reschedule Test',
        body: 'Reschedule Body',
        scheduledAt: new Date(Date.now() + 100),
      });

      worker = createEmailWorker();

      // Wait 1.5 seconds for worker to process job
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Verify email status returned to QUEUED
      const updatedEmail = await prisma.scheduledEmail.findUnique({
        where: { id: scheduled.scheduledEmailId },
      });

      if (!updatedEmail || (updatedEmail.status !== EmailStatus.QUEUED && updatedEmail.status !== EmailStatus.SCHEDULED)) {
        throw new Error(`Expected status QUEUED or SCHEDULED, got ${updatedEmail?.status}`);
      }

      // Verify RESCHEDULED DeliveryLog entry
      const logs = await prisma.deliveryLog.findMany({
        where: { scheduledEmailId: scheduled.scheduledEmailId },
      });

      const reschedLog = logs.find((l) => l.eventType === DeliveryEventType.RESCHEDULED);
      if (!reschedLog) {
        throw new Error('Missing DeliveryEventType.RESCHEDULED event log');
      }

      const meta = reschedLog.metadata as any;
      if (meta?.reason !== 'HOURLY_LIMIT' || !meta?.retryAfterMs) {
        throw new Error('RESCHEDULED metadata does not contain correct reason or retryAfterMs');
      }
    });

    // Cleanup
    console.log('\n🧹 Cleaning up test data...');
    if (worker) await worker.close();
    await RateLimiterService.resetRateLimits(testCampaign.id, testAccount.id);
    await prisma.user.delete({ where: { id: testUser.id } });
    console.log('✨ Cleanup complete.');

    console.log(`\n📊 Throttling & Rate Limiting Test Results: ${passedCount}/${totalCount} tests passed.`);
    if (passedCount < totalCount) {
      process.exit(1);
    }
  } catch (globalErr) {
    console.error('Fatal error during throttling test run:', globalErr);
    if (worker) await worker.close();
    process.exit(1);
  } finally {
    EmailDeliveryService.sendEmail = originalSendEmail;
    await prisma.$disconnect();
    await redisConnection.quit();
  }
}

runThrottlingTests();
