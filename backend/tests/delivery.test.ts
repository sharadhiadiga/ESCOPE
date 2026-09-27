import { EmailDeliveryService } from '../src/services/emailDelivery.service';
process.env.NODE_ENV = 'test';
import { prisma, EmailStatus, DeliveryEventType } from '../src/db';
import { UserService } from '../src/services/user.service';
import { EmailAccountService } from '../src/services/emailAccount.service';
import { CampaignService } from '../src/services/campaign.service';
import { EmailSchedulingService } from '../src/services/emailScheduling.service';
import { emailQueue } from '../src/queues/email.queue';
import nodemailer from 'nodemailer';

async function runDeliveryTests() {
  console.log('🧪 Starting Phase 5 Real SMTP Delivery & Security Integration Tests...\n');
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
  let accountA: any;
  let accountB: any;
  let campaignA: any;
  let campaignB: any;

  // Mock Nodemailer createTransport
  const originalCreateTransport = nodemailer.createTransport;
  let lastSentMailOptions: any = null;
  let shouldFailSmtp = false;

  nodemailer.createTransport = function (config: any) {
    return {
      sendMail: async (options: any) => {
        lastSentMailOptions = options;
        if (shouldFailSmtp) {
          throw new Error('SMTP connection error: Authentication failed');
        }
        return {
          messageId: `ethereal_test_${Date.now()}`,
          accepted: [options.to],
          rejected: [],
        };
      },
    } as any;
  };

  try {
    // Setup test users & accounts
    testUser = await UserService.createUser({
      email: `smtp_user_${testRunId}@example.com`,
      name: 'SMTP Tester',
    });

    accountA = await EmailAccountService.createEmailAccount({
      userId: testUser.id,
      email: `senderA_${testRunId}@ethereal.email`,
      displayName: 'Sender Alpha',
      smtpHost: 'smtp.ethereal.email',
      smtpPort: 587,
      smtpUser: 'user_alpha',
      smtpPassword: 'secret_alpha_password',
      provider: 'ethereal',
    });

    accountB = await EmailAccountService.createEmailAccount({
      userId: testUser.id,
      email: `senderB_${testRunId}@ethereal.email`,
      displayName: 'Sender Beta',
      smtpHost: 'smtp.ethereal.email',
      smtpPort: 587,
      smtpUser: 'user_beta',
      smtpPassword: 'secret_beta_password',
      provider: 'ethereal',
    });

    campaignA = await CampaignService.createCampaign({
      userId: testUser.id,
      senderAccountId: accountA.id,
      name: 'Campaign Alpha',
      subject: 'Alpha Subject',
      body: 'Body Alpha',
      startAt: new Date(),
    });

    campaignB = await CampaignService.createCampaign({
      userId: testUser.id,
      senderAccountId: accountB.id,
      name: 'Campaign Beta',
      subject: 'Beta Subject',
      body: 'Body Beta',
      startAt: new Date(),
    });

    // 1. EmailDeliveryService uses correct EmailAccount for Campaign A
    await test('1. EmailDeliveryService sends email using Campaign A Sender Credentials', async () => {
      lastSentMailOptions = null;
      const fullAccountA = await EmailAccountService.getAccountWithCredentials(accountA.id);
      if (!fullAccountA) throw new Error('Failed to retrieve full credentials for Account A');

      const result = await EmailDeliveryService.sendEmail({
        to: 'recipientA@example.com',
        recipientName: 'Recipient Alpha',
        subject: 'Subject Alpha',
        body: 'Body Alpha',
        senderAccount: fullAccountA,
      });

      if (!result.success || !result.messageId) {
        throw new Error('Email delivery failed or did not return messageId');
      }
      if (!lastSentMailOptions || !lastSentMailOptions.from.includes(accountA.email)) {
        throw new Error(`Expected sender ${accountA.email}, got ${lastSentMailOptions?.from}`);
      }
    });

    // 2. Multi-tenant Sender Account Resolution for Campaign B
    await test('2. EmailDeliveryService sends email using Campaign B Sender Credentials (Multi-tenant)', async () => {
      lastSentMailOptions = null;
      const fullAccountB = await EmailAccountService.getAccountWithCredentials(accountB.id);
      if (!fullAccountB) throw new Error('Failed to retrieve full credentials for Account B');

      const result = await EmailDeliveryService.sendEmail({
        to: 'recipientB@example.com',
        recipientName: 'Recipient Beta',
        subject: 'Subject Beta',
        body: 'Body Beta',
        senderAccount: fullAccountB,
      });

      if (!result.success || !result.messageId) {
        throw new Error('Email delivery failed or did not return messageId');
      }
      if (!lastSentMailOptions || !lastSentMailOptions.from.includes(accountB.email)) {
        throw new Error(`Expected sender ${accountB.email}, got ${lastSentMailOptions?.from}`);
      }
    });

    // 3. Security Check: Credentials NEVER in BullMQ job data or DeliveryLog metadata
    await test('3. Credentials are NEVER stored in BullMQ job data or DeliveryLog metadata', async () => {
      // Schedule an email to generate BullMQ job & DeliveryLog
      const scheduled = await EmailSchedulingService.scheduleEmail(testUser.id, {
        campaignId: campaignA.id,
        recipientEmail: 'security_test@example.com',
        subject: 'Security Check',
        body: 'Body Content',
        scheduledAt: new Date(Date.now() + 60000), // 1 minute in future
      });

      const job = await emailQueue.getJob(scheduled.queueJobId);
      if (job) {
        const payloadStr = JSON.stringify(job.data);
        if (payloadStr.includes('secret_') || payloadStr.includes('smtpPassword')) {
          throw new Error('SECURITY VIOLATION: SMTP password found in Redis job payload!');
        }
      }

      const logs = await prisma.deliveryLog.findMany({
        where: { scheduledEmailId: scheduled.scheduledEmailId },
      });

      for (const log of logs) {
        const metaStr = JSON.stringify(log.metadata || {});
        if (metaStr.includes('secret_') || metaStr.includes('smtpPassword')) {
          throw new Error('SECURITY VIOLATION: SMTP password found in DeliveryLog metadata!');
        }
      }
    });

    // 4. SMTP Failure Handling Exception Propagation
    await test('4. EmailDeliveryService handles SMTP failure by throwing clean error', async () => {
      shouldFailSmtp = true;
      const fullAccountA = await EmailAccountService.getAccountWithCredentials(accountA.id);

      let threw = false;
      try {
        await EmailDeliveryService.sendEmail({
          to: 'fail@example.com',
          subject: 'Failing Email',
          body: 'Fail body',
          senderAccount: fullAccountA!,
        });
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('Authentication failed')) {
          throw new Error(`Unexpected error message: ${err.message}`);
        }
      }
      if (!threw) throw new Error('Expected sendEmail to throw on SMTP failure');
    });

    // Cleanup
    console.log('\n🧹 Cleaning up test data...');
    await prisma.user.delete({ where: { id: testUser.id } });
    console.log('✨ Cleanup complete.');

    console.log(`\n📊 Real SMTP Delivery Test Results: ${passedCount}/${totalCount} tests passed.`);
    if (passedCount < totalCount) {
      process.exit(1);
    }
  } catch (globalErr) {
    console.error('Fatal error during delivery test run:', globalErr);
    process.exit(1);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    await prisma.$disconnect();
  }
}

runDeliveryTests();
