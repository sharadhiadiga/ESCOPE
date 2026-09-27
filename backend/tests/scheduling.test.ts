process.env.NODE_ENV = 'test';
import { prisma, EmailStatus, DeliveryEventType } from '../src/db';
import { UserService } from '../src/services/user.service';
import { EmailAccountService } from '../src/services/emailAccount.service';
import { CampaignService } from '../src/services/campaign.service';
import { EmailSchedulingService } from '../src/services/emailScheduling.service';
import { EmailDeliveryService } from '../src/services/emailDelivery.service';
import { RateLimiterService } from '../src/services/rateLimiter.service';
import { createEmailWorker } from '../src/workers/email.worker';
import { emailQueue } from '../src/queues/email.queue';
import { redisConnection } from '../src/config/redis';

async function runSchedulingTests() {
  console.log('🧪 Starting Phase 4 Email Scheduling & BullMQ Integration Tests...\n');
  let passedCount = 0;
  let totalCount = 0;

  const originalSendEmail = EmailDeliveryService.sendEmail;
  EmailDeliveryService.sendEmail = async (payload) => ({
    success: true,
    messageId: `mock_msg_${Date.now()}`,
    accepted: [payload.to],
    rejected: [],
  });

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

  try {
    // Setup test user, email account, and campaign
    testUser = await UserService.createUser({
      email: `scheduler_user_${testRunId}@example.com`,
      name: 'Scheduler Tester',
    });

    testAccount = await EmailAccountService.createEmailAccount({
      userId: testUser.id,
      email: `sender_${testRunId}@ethereal.email`,
      displayName: 'Sender Test',
      smtpHost: 'smtp.ethereal.email',
      smtpPort: 587,
      smtpUser: 'ethereal_user',
      smtpPassword: 'secret_password',
      provider: 'ethereal',
    });

    testCampaign = await CampaignService.createCampaign({
      userId: testUser.id,
      senderAccountId: testAccount.id,
      name: 'Phase 4 Test Campaign',
      subject: 'Phase 4 Outreach',
      body: 'Testing BullMQ Scheduling',
      startAt: new Date(),
      delayBetweenEmailsMs: 0,
    });

    // 1 & 3 & 4 & 5 & 6. Schedule email, check PostgreSQL persistence & BullMQ delayed job creation
    let scheduledResult: any;
    const futureDate = new Date(Date.now() + 500); // 0.5s in future

    await test('1. Authenticated email scheduling persists in DB and creates delayed BullMQ job', async () => {
      scheduledResult = await EmailSchedulingService.scheduleEmail(testUser.id, {
        campaignId: testCampaign.id,
        recipientEmail: 'lead1@example.com',
        recipientName: 'Lead One',
        subject: 'Future Email Subject',
        body: 'Body text',
        scheduledAt: futureDate,
      });

      if (!scheduledResult.scheduledEmailId || !scheduledResult.queueJobId) {
        throw new Error('Scheduling did not return scheduledEmailId or queueJobId');
      }

      // Check PostgreSQL persistence
      const dbEmail = await prisma.scheduledEmail.findUnique({
        where: { id: scheduledResult.scheduledEmailId },
      });
      if (!dbEmail || dbEmail.status !== EmailStatus.QUEUED || dbEmail.queueJobId !== scheduledResult.queueJobId) {
        throw new Error('Database record does not match expected QUEUED state or queueJobId');
      }

      // Check BullMQ queue job
      const bullJob = await emailQueue.getJob(scheduledResult.queueJobId);
      if (!bullJob) {
        throw new Error('BullMQ job was not found in Redis queue');
      }
      if (bullJob.data.scheduledEmailId !== scheduledResult.scheduledEmailId) {
        throw new Error('BullMQ job payload does not contain correct scheduledEmailId');
      }
    });

    // 2. Reject scheduling for another user's campaign
    await test('2. Reject scheduling for unauthorized campaign owner', async () => {
      let threw = false;
      try {
        await EmailSchedulingService.scheduleEmail('fake-other-user-id', {
          campaignId: testCampaign.id,
          recipientEmail: 'unauthorized@example.com',
          subject: 'Unauthorized',
          body: 'Text',
          scheduledAt: new Date(),
        });
      } catch (err) {
        threw = true;
      }
      if (!threw) throw new Error('Allowed unauthorized scheduling');
    });

    // 12. Idempotency Check: Duplicate scheduling returns existing job without duplicate creation
    await test('12. Duplicate idempotencyKey returns existing job without creating duplicate DB/Queue items', async () => {
      const duplicateKey = `idempotency_test_${testRunId}`;
      const first = await EmailSchedulingService.scheduleEmail(testUser.id, {
        campaignId: testCampaign.id,
        recipientEmail: 'idempotent@example.com',
        subject: 'Idempotency Test',
        body: 'Text',
        scheduledAt: new Date(Date.now() + 5000),
        idempotencyKey: duplicateKey,
      });

      const second = await EmailSchedulingService.scheduleEmail(testUser.id, {
        campaignId: testCampaign.id,
        recipientEmail: 'idempotent@example.com',
        subject: 'Idempotency Test',
        body: 'Text',
        scheduledAt: new Date(Date.now() + 5000),
        idempotencyKey: duplicateKey,
      });

      if (!second.isDuplicate || second.scheduledEmailId !== first.scheduledEmailId) {
        throw new Error('Duplicate scheduling was not recognized as idempotent duplicate');
      }
    });

    // 7 & 8 & 9. Start Worker process to process the scheduled email job
    await test('7, 8, 9. Worker processes delayed job, updates status to SENT, and creates DeliveryLog', async () => {
      await RateLimiterService.resetRateLimits(testCampaign.id, testAccount.id);
      worker = createEmailWorker();

      // Wait for worker to pick up and process the delayed job (wait ~2.5s)
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const processedEmail = await prisma.scheduledEmail.findUnique({
        where: { id: scheduledResult.scheduledEmailId },
      });

      if (!processedEmail || processedEmail.status !== EmailStatus.SENT || !processedEmail.sentAt) {
        throw new Error(`Email status was not updated to SENT. Current status: ${processedEmail?.status}`);
      }

      // Verify DeliveryLog entries
      const logs = await prisma.deliveryLog.findMany({
        where: { scheduledEmailId: scheduledResult.scheduledEmailId },
        orderBy: { createdAt: 'asc' },
      });

      const eventTypes = logs.map((l) => l.eventType);
      if (!eventTypes.includes(DeliveryEventType.SENT)) {
        throw new Error(`Missing SENT delivery log event. Events logged: ${eventTypes.join(', ')}`);
      }
    });

    // 10. Idempotent worker handling: Already-SENT email is not re-processed
    await test('10. Already-SENT email is skipped by worker without re-sending', async () => {
      const sentEmail = await prisma.scheduledEmail.findUnique({
        where: { id: scheduledResult.scheduledEmailId },
      });

      const initialSentAt = sentEmail?.sentAt;

      // Simulate re-adding job to queue
      await emailQueue.add(
        'send-email',
        {
          scheduledEmailId: scheduledResult.scheduledEmailId,
          campaignId: testCampaign.id,
          idempotencyKey: sentEmail!.idempotencyKey,
        },
        { jobId: `retry_test_${Date.now()}` }
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      const reCheckEmail = await prisma.scheduledEmail.findUnique({
        where: { id: scheduledResult.scheduledEmailId },
      });

      if (reCheckEmail?.sentAt?.getTime() !== initialSentAt?.getTime()) {
        throw new Error('Already SENT email was re-processed!');
      }
    });

    // Cleanup test data
    console.log('\n🧹 Cleaning up test data...');
    if (worker) await worker.close();
    await prisma.user.delete({ where: { id: testUser.id } });
    console.log('✨ Cleanup complete.');

    console.log(`\n📊 Scheduling & BullMQ Test Results: ${passedCount}/${totalCount} tests passed.`);
    if (passedCount < totalCount) {
      process.exit(1);
    }
  } catch (globalErr) {
    console.error('Fatal error during scheduling test run:', globalErr);
    if (worker) await worker.close();
    process.exit(1);
  } finally {
    EmailDeliveryService.sendEmail = originalSendEmail;
    await prisma.$disconnect();
    await redisConnection.quit();
  }
}

runSchedulingTests();
