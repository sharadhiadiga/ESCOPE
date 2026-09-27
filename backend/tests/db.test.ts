import { prisma, EmailStatus, CampaignStatus, DeliveryEventType } from '../src/db';
import {
  UserService,
  EmailAccountService,
  CampaignService,
  ScheduledEmailService,
} from '../src/services';

async function runTests() {
  console.log('🧪 Starting Phase 2 Database & Persistence Integration Tests...\n');
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

  try {
    // 1. Database Connection Test
    await test('1. Database Connection', async () => {
      const res = await prisma.$queryRaw`SELECT 1 as connected`;
      if (!res) throw new Error('Database connection failed');
    });

    const testRunId = Date.now();
    const testEmail = `test_user_${testRunId}@example.com`;

    let createdUser: any;
    // 2. User Creation
    await test('2. User Creation', async () => {
      createdUser = await UserService.createUser({
        email: testEmail,
        name: 'Test Candidate',
        avatarUrl: 'https://example.com/avatar.png',
      });
      if (!createdUser.id || createdUser.email !== testEmail) {
        throw new Error('User creation returned invalid user');
      }
    });

    // 3. Unique Email Constraint
    await test('3. Unique Email Constraint', async () => {
      let threw = false;
      try {
        await UserService.createUser({
          email: testEmail,
          name: 'Duplicate Candidate',
        });
      } catch (err) {
        threw = true;
      }
      if (!threw) throw new Error('Expected duplicate email to throw an error');
    });

    // 4. Sender Account Creation
    let createdAccount: any;
    await test('4. Sender / Email Account Creation', async () => {
      createdAccount = await EmailAccountService.createEmailAccount({
        userId: createdUser.id,
        email: `sender_${testRunId}@ethereal.email`,
        displayName: 'Test Sender',
        smtpHost: 'smtp.ethereal.email',
        smtpPort: 587,
        smtpUser: 'ethereal_user',
        smtpPassword: 'secret_password',
        provider: 'ethereal',
      });
      if (!createdAccount.id || createdAccount.userId !== createdUser.id) {
        throw new Error('Email account creation failed');
      }
    });

    // 5. Campaign Creation
    let createdCampaign: any;
    await test('5. Campaign Creation', async () => {
      createdCampaign = await CampaignService.createCampaign({
        userId: createdUser.id,
        senderAccountId: createdAccount.id,
        name: 'Fall Outreach Campaign',
        subject: 'Hello from ReachInbox',
        body: 'Welcome to ReachInbox Phase 2',
        startAt: new Date(),
        delayBetweenEmailsMs: 2000,
        hourlyLimit: 200,
      });
      if (!createdCampaign.id || createdCampaign.status !== CampaignStatus.SCHEDULED) {
        throw new Error('Campaign creation failed');
      }
    });

    // 6. Scheduled Email Creation
    const testKey = `idempotency_${testRunId}_1`;
    let createdEmail: any;
    await test('6. Scheduled Email Creation', async () => {
      createdEmail = await ScheduledEmailService.createScheduledEmail({
        campaignId: createdCampaign.id,
        recipientEmail: 'recipient@example.com',
        recipientName: 'Jane Doe',
        subject: 'Welcome Jane',
        body: 'Hello Jane Doe',
        scheduledAt: new Date(Date.now() + 60000),
        idempotencyKey: testKey,
      });
      if (!createdEmail.id || createdEmail.idempotencyKey !== testKey) {
        throw new Error('Scheduled email creation failed');
      }
    });

    // 7. Unique IdempotencyKey Constraint
    await test('7. Unique IdempotencyKey Constraint', async () => {
      let threw = false;
      try {
        await ScheduledEmailService.createScheduledEmail({
          campaignId: createdCampaign.id,
          recipientEmail: 'another@example.com',
          subject: 'Duplicate key test',
          body: 'Duplicate body',
          scheduledAt: new Date(),
          idempotencyKey: testKey, // Same key
        });
      } catch (err) {
        threw = true;
      }
      if (!threw) throw new Error('Expected duplicate idempotencyKey to throw an error');
    });

    // 8. Relationship Cascade & Query Chain (User -> EmailAccount & Campaign -> ScheduledEmail)
    await test('8. Relationship chain (User -> Campaign -> ScheduledEmail)', async () => {
      const userCampaigns = await CampaignService.findCampaignsByUserId(createdUser.id);
      if (userCampaigns.length === 0) throw new Error('Failed to query campaigns by user');
      const campaignWithEmails = await CampaignService.findCampaignById(createdCampaign.id);
      if (!campaignWithEmails || campaignWithEmails.scheduledEmails.length === 0) {
        throw new Error('Failed to query campaign with scheduled emails');
      }
    });

    // 9. Status Updates & Delivery Log
    await test('9. Status updates & Delivery Log creation', async () => {
      const now = new Date();
      const updated = await ScheduledEmailService.updateScheduledEmailStatus(
        createdEmail.id,
        EmailStatus.SENT,
        { sentAt: now, queueJobId: 'bullmq_job_123' }
      );
      if (updated.status !== EmailStatus.SENT || !updated.sentAt) {
        throw new Error('Scheduled email status update failed');
      }

      const log = await ScheduledEmailService.logDeliveryEvent(
        createdEmail.id,
        DeliveryEventType.SENT,
        { provider: 'ethereal', responseCode: 250 }
      );
      if (!log.id || log.eventType !== DeliveryEventType.SENT) {
        throw new Error('Delivery log creation failed');
      }
    });

    // Cleanup test data
    console.log('\n🧹 Cleaning up test data...');
    await prisma.user.delete({ where: { id: createdUser.id } });
    console.log('✨ Cleanup complete.');

    console.log(`\n📊 Test Results: ${passedCount}/${totalCount} tests passed.`);
    if (passedCount < totalCount) {
      process.exit(1);
    }
  } catch (globalErr) {
    console.error('Fatal error during test run:', globalErr);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
