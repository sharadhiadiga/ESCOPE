process.env.NODE_ENV = 'test';
import { prisma, EmailStatus, DeliveryEventType, CampaignStatus } from '../src/db';
import { SlackConnectionService } from '../src/services/slackConnection.service';
import { SlackNotificationService } from '../src/services/slackNotification.service';
import { UserService } from '../src/services/user.service';
import { RateLimiterService } from '../src/services/rateLimiter.service';
import { EmailSchedulingService } from '../src/services/emailScheduling.service';
import { EmailAccountService } from '../src/services/emailAccount.service';
import { emailQueue } from '../src/queues/email.queue';
import { redisConnection } from '../src/config/redis';

async function runSlackTests() {
  console.log('🧪 Starting Phase 7 Real Slack OAuth & Tenant-Aware Notification Tests...\n');
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
  let userA: any;
  let userB: any;

  try {
    // Setup test users
    userA = await UserService.createUser({
      email: `slack_usera_${testRunId}@example.com`,
      name: 'Slack User A',
    });

    userB = await UserService.createUser({
      email: `slack_userb_${testRunId}@example.com`,
      name: 'Slack User B',
    });

    // 1. Create/Upsert SlackConnection for User A
    await test('1. SlackConnection can be created and upserted for a user', async () => {
      const conn = await prisma.slackConnection.create({
        data: {
          userId: userA.id,
          slackUserId: 'U123456',
          teamId: 'T111111',
          teamName: 'Acme Workspace',
          botAccessToken: 'xoxb-mock-token-alpha',
          incomingWebhookUrl: 'https://hooks.slack.com/services/mock/webhook/alpha',
          channel: '#general',
          channelId: 'C111111',
          isActive: true,
        },
      });

      if (!conn || conn.userId !== userA.id || conn.teamName !== 'Acme Workspace') {
        throw new Error('Failed to create SlackConnection record');
      }
    });

    // 2. Reconnect updates existing connection credentials
    await test('2. Reconnect updates existing user connection credentials cleanly', async () => {
      const updated = await prisma.slackConnection.upsert({
        where: { userId: userA.id },
        create: {
          userId: userA.id,
          teamName: 'Acme Updated Workspace',
          botAccessToken: 'xoxb-mock-token-new',
          isActive: true,
        },
        update: {
          teamName: 'Acme Updated Workspace',
          botAccessToken: 'xoxb-mock-token-new',
          isActive: true,
        },
      });

      if (updated.teamName !== 'Acme Updated Workspace' || updated.botAccessToken !== 'xoxb-mock-token-new') {
        throw new Error('Failed to update existing connection on reconnect');
      }
    });

    // 3. Security: Status endpoint NEVER returns tokens or webhooks
    await test('3. Status endpoint returns safe information and NEVER exposes tokens or webhooks', async () => {
      const status = await SlackConnectionService.getConnectionStatus(userA.id);

      if (!status.isConnected || status.teamName !== 'Acme Updated Workspace') {
        throw new Error('Invalid status output');
      }

      // Assert status object structure
      const keys = Object.keys(status);
      if (keys.includes('botAccessToken') || keys.includes('incomingWebhookUrl')) {
        throw new Error('SECURITY VIOLATION: Access token or Webhook URL exposed in status object!');
      }

      const jsonStr = JSON.stringify(status);
      if (jsonStr.includes('xoxb-') || jsonStr.includes('hooks.slack.com')) {
        throw new Error('SECURITY VIOLATION: Token string present in status JSON response!');
      }
    });

    // 4. Disconnect deactivates connection
    await test('4. Disconnect deactivates current user Slack connection', async () => {
      await SlackConnectionService.disconnect(userA.id);

      const status = await SlackConnectionService.getConnectionStatus(userA.id);
      if (status.isConnected !== false || status.teamName !== null) {
        throw new Error('Connection was not properly deactivated on disconnect');
      }
    });

    // Re-activate connection for User A
    await prisma.slackConnection.update({
      where: { userId: userA.id },
      data: { isActive: true },
    });

    // 5. Tenant Isolation: User A cannot access User B's Slack connection
    await test('5. Tenant Isolation: User B cannot access User A Slack connection', async () => {
      const statusB = await SlackConnectionService.getConnectionStatus(userB.id);
      if (statusB.isConnected !== false) {
        throw new Error('User B incorrectly returned active status for User A connection');
      }

      const credsB = await SlackConnectionService.getCredentialsForUser(userB.id);
      if (credsB !== null) {
        throw new Error('User B accessed User A credentials');
      }
    });

    // 6. Missing Slack connection does not throw
    await test('6. Missing Slack connection returns false gracefully without throwing', async () => {
      const result = await SlackNotificationService.notifyRateLimitExceeded({
        userId: userB.id, // User B has no connection
        campaignId: 'c_mock_b',
        campaignName: 'Campaign B',
        hourlyLimit: 10,
      });

      if (result !== false) {
        throw new Error('Expected false when notifying user without Slack connection');
      }
    });

    // 7. Non-blocking network failure handling
    await test('7. Slack API failure / network error does not break application flow', async () => {
      const originalFetch = global.fetch;
      global.fetch = (async () => {
        throw new Error('Network error connecting to Slack API');
      }) as any;

      try {
        const result = await SlackNotificationService.notifyRateLimitExceeded({
          userId: userA.id,
          campaignId: `c_network_fail_${Date.now()}`,
          campaignName: 'Network Fail Campaign',
          hourlyLimit: 10,
        });

        if (result !== false) {
          throw new Error('Expected false on network error');
        }
      } finally {
        global.fetch = originalFetch;
      }
    });

    // 8. Revoked connection is safely deactivated
    await test('8. Revoked token or HTTP 401 response safely deactivates connection', async () => {
      const originalFetch = global.fetch;
      global.fetch = (async () => ({
        status: 401,
        ok: false,
        json: async () => ({ ok: false, error: 'token_revoked' }),
      })) as any;

      try {
        const result = await SlackNotificationService.notifyRateLimitExceeded({
          userId: userA.id,
          campaignId: `c_revoked_${Date.now()}`,
          campaignName: 'Revoked Campaign',
          hourlyLimit: 10,
        });

        if (result !== false) {
          throw new Error('Expected false on revoked token response');
        }

        const status = await SlackConnectionService.getConnectionStatus(userA.id);
        if (status.isConnected !== false) {
          throw new Error('Connection was not marked inactive upon token revocation');
        }
      } finally {
        global.fetch = originalFetch;
      }
    });

    // Re-activate User A connection for remaining test
    await prisma.slackConnection.update({
      where: { userId: userA.id },
      data: { isActive: true },
    });

    // 9. Correct user mapping & notification payload test
    await test('9. Tenant-aware alert resolves correct user webhook and payload formatting', async () => {
      let postedUrl = '';
      let postedBody: any = null;

      const originalFetch = global.fetch;
      global.fetch = (async (url: string, opts: any) => {
        postedUrl = url;
        postedBody = JSON.parse(opts.body);
        return {
          status: 200,
          ok: true,
          json: async () => ({ ok: true }),
        };
      }) as any;

      try {
        const campaignId = `c_tenant_test_${Date.now()}`;
        const success = await SlackNotificationService.notifyRateLimitExceeded({
          userId: userA.id,
          campaignId,
          campaignName: 'User A Campaign',
          hourlyLimit: 5,
        });

        if (!success) {
          throw new Error('Notification should succeed with valid connection');
        }

        if (!postedUrl.includes('hooks.slack.com') && !postedUrl.includes('slack.com')) {
          throw new Error(`Unexpected post URL: ${postedUrl}`);
        }

        if (!postedBody?.text?.includes("User A Campaign")) {
          throw new Error(`Formatted text missing campaign name: ${postedBody?.text}`);
        }
      } finally {
        global.fetch = originalFetch;
      }
    });

    // 10. Credentials isolation in logs & Redis
    await test('10. Slack credentials NEVER appear in delivery logs or BullMQ Redis payloads', async () => {
      const emailAccount = await EmailAccountService.createEmailAccount({
        userId: userA.id,
        email: `sender_slack_${testRunId}@ethereal.email`,
        displayName: 'Sender Slack',
        smtpHost: 'smtp.ethereal.email',
        smtpPort: 587,
        smtpUser: 'ethereal_user',
        smtpPassword: 'secret_password',
        provider: 'ethereal',
      });

      const campaign = await prisma.campaign.create({
        data: {
          userId: userA.id,
          senderAccountId: emailAccount.id,
          name: 'Security Campaign',
          subject: 'Security Check',
          body: 'Content',
          startAt: new Date(),
        },
      });

      const scheduled = await EmailSchedulingService.scheduleEmail(userA.id, {
        campaignId: campaign.id,
        recipientEmail: 'lead_security@example.com',
        subject: 'Security Subject',
        body: 'Security Body',
        scheduledAt: new Date(Date.now() + 60000),
      });

      const job = await emailQueue.getJob(scheduled.queueJobId);
      if (job) {
        const jobStr = JSON.stringify(job.data);
        if (jobStr.includes('xoxb-') || jobStr.includes('hooks.slack.com')) {
          throw new Error('SECURITY VIOLATION: Slack token/webhook found in BullMQ job data!');
        }
      }

      const logs = await prisma.deliveryLog.findMany({
        where: { scheduledEmailId: scheduled.scheduledEmailId },
      });

      for (const log of logs) {
        const metaStr = JSON.stringify(log.metadata || {});
        if (metaStr.includes('xoxb-') || metaStr.includes('hooks.slack.com')) {
          throw new Error('SECURITY VIOLATION: Slack token/webhook found in DeliveryLog metadata!');
        }
      }
    });

    // Cleanup
    console.log('\n🧹 Cleaning up test data...');
    if (userA) await prisma.user.delete({ where: { id: userA.id } });
    if (userB) await prisma.user.delete({ where: { id: userB.id } });
    console.log('✨ Cleanup complete.');

    console.log(`\n📊 Real Slack OAuth & Tenant Notification Test Results: ${passedCount}/${totalCount} tests passed.`);
    if (passedCount < totalCount) {
      process.exit(1);
    }
  } catch (globalErr) {
    console.error('Fatal error during Slack test run:', globalErr);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await redisConnection.quit();
  }
}

runSlackTests();
