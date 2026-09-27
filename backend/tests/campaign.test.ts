process.env.NODE_ENV = 'test';
import { UserService } from '../src/services/user.service';
import { EmailAccountService } from '../src/services/emailAccount.service';
import { prisma } from '../src/db';
import app from '../src/app';
import http from 'http';

async function runCampaignTests() {
  console.log('🧪 Starting Phase 8C-2 Campaign & Email Account API Tests...\n');
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
  let user: any;

  try {
    user = await UserService.createUser({
      email: `campaign_user_${testRunId}@example.com`,
      name: 'Campaign Tester',
    });

    // 1. Email Accounts Service & Security
    await test('1. EmailAccountService.ensureUserAccount returns sanitized accounts without exposing passwords', async () => {
      const accounts = await EmailAccountService.ensureUserAccount(user.id, user.email);
      if (!Array.isArray(accounts) || accounts.length === 0) {
        throw new Error('Expected at least 1 sender account returned');
      }
      const account = accounts[0];
      if ((account as any).smtpPassword) {
        throw new Error('SECURITY VIOLATION: smtpPassword exposed in API account object');
      }
      if (!account.email || !account.smtpHost) {
        throw new Error('Account missing required email/host metadata');
      }
    });

    // 2. HTTP Route Protection for Email Accounts
    await test('2. GET /api/email-accounts requires authentication', async () => {
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const address = server.address() as { port: number };

      try {
        const res = await fetch(`http://localhost:${address.port}/api/email-accounts`);
        if (res.status !== 401) {
          throw new Error(`Expected HTTP 401 for unauthenticated request, got ${res.status}`);
        }
      } finally {
        server.close();
      }
    });

    // 3. HTTP Route Protection for Campaign Scheduling
    await test('3. POST /api/emails/campaign requires authentication', async () => {
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const address = server.address() as { port: number };

      try {
        const res = await fetch(`http://localhost:${address.port}/api/emails/campaign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Test Campaign' }),
        });
        if (res.status !== 401) {
          throw new Error(`Expected HTTP 401 for unauthenticated request, got ${res.status}`);
        }
      } finally {
        server.close();
      }
    });

    // 4. Programmatic Browser Payload Campaign Creation & Past Date Resilience
    await test('4. Campaign scheduling handles browser payload with immediate / past startAt dates gracefully', async () => {
      const accounts = await EmailAccountService.ensureUserAccount(user.id, user.email);
      const pastStartAt = new Date(Date.now() - 30000).toISOString(); // 30 seconds ago

      const payload = {
        name: 'Browser Payload Test Campaign',
        senderAccountId: accounts[0].id,
        subject: 'Welcome to Outreach',
        body: 'Hello {{Name}}, welcome!',
        startAt: pastStartAt,
        delayBetweenEmailsMs: 1000,
        hourlyLimit: 100,
        leads: [
          { recipientEmail: `lead1_${testRunId}@example.com`, recipientName: 'Lead One' },
          { recipientEmail: `lead2_${testRunId}@example.com`, recipientName: 'Lead Two' },
        ],
      };

      const req: any = {
        user: { id: user.id, email: user.email },
        body: payload,
      };

      let statusCode = 0;
      let responseJson: any = null;

      const res: any = {
        status: (code: number) => {
          statusCode = code;
          return {
            json: (data: any) => {
              responseJson = data;
              return res;
            },
          };
        },
      };

      const { EmailSchedulingController } = require('../src/controllers/emailScheduling.controller');
      await EmailSchedulingController.scheduleCampaign(req, res);

      if (statusCode !== 201 || !responseJson?.success) {
        throw new Error(`Expected HTTP 201 Created, got HTTP ${statusCode}: ${JSON.stringify(responseJson)}`);
      }

      if (responseJson.data.scheduledCount !== 2) {
        throw new Error(`Expected 2 scheduled emails, got ${responseJson.data.scheduledCount}`);
      }
    });

    // 5. Browser Payload with Null recipientName
    await test('5. Campaign scheduling supports null recipientName in lead payload without 400 error', async () => {
      const accounts = await EmailAccountService.ensureUserAccount(user.id, user.email);
      const payload = {
        name: 'Null RecipientName Test Campaign',
        senderAccountId: accounts[0].id,
        subject: 'Null Name Test',
        body: 'Testing null recipientName',
        startAt: new Date().toISOString(),
        delayBetweenEmailsMs: 2000,
        hourlyLimit: 200,
        leads: [
          { recipientEmail: `nullname_${testRunId}@example.com`, recipientName: null },
        ],
      };

      const req: any = {
        user: { id: user.id, email: user.email },
        body: payload,
      };

      let statusCode = 0;
      let responseJson: any = null;

      const res: any = {
        status: (code: number) => {
          statusCode = code;
          return {
            json: (data: any) => {
              responseJson = data;
              return res;
            },
          };
        },
      };

      const { EmailSchedulingController } = require('../src/controllers/emailScheduling.controller');
      await EmailSchedulingController.scheduleCampaign(req, res);

      if (statusCode !== 201 || !responseJson?.success) {
        throw new Error(`Expected HTTP 201 Created for null recipientName, got HTTP ${statusCode}: ${JSON.stringify(responseJson)}`);
      }
    });
  } finally {
    if (user) await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(`\n📊 Campaign API Test Results: ${passedCount}/${totalCount} PASSED`);
  if (passedCount < totalCount) {
    process.exit(1);
  }
}

runCampaignTests().catch((err) => {
  console.error('Unhandled failure in campaign.test.ts:', err);
  process.exit(1);
});
