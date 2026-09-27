process.env.NODE_ENV = 'test';
import { setupBullBoard } from '../src/config/bullBoard';
import { emailQueue } from '../src/queues/email.queue';
import { redisConnection } from '../src/config/redis';
import app from '../src/app';
import http from 'http';

async function runDashboardTests() {
  console.log('🧪 Starting Phase 8B BullMQ Dashboard Verification Tests...\n');
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
    // 1. Bull Board Server Adapter setup
    await test('1. Bull Board adapter initializes with email-scheduling queue', async () => {
      const adapter = setupBullBoard();
      if (!adapter) {
        throw new Error('ExpressAdapter failed to initialize');
      }
      const router = adapter.getRouter();
      if (!router) {
        throw new Error('ExpressAdapter router not created');
      }
    });

    // 2. Queue Connection & State Monitoring
    await test('2. BullMQ emailQueue is connected and reports state metrics', async () => {
      const counts = await emailQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
      if (typeof counts.waiting !== 'number' || typeof counts.active !== 'number') {
        throw new Error('Failed to retrieve job counts from connected BullMQ emailQueue');
      }
      console.log(`     [Queue Metrics] Waiting: ${counts.waiting}, Active: ${counts.active}, Delayed: ${counts.delayed}, Completed: ${counts.completed}, Failed: ${counts.failed}`);
    });

    // 3. HTTP Server Mount & Authentication Check
    await test('3. Express server mounts /admin/queues route with authentication protection', async () => {
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const address = server.address() as { port: number };

      try {
        const res = await fetch(`http://localhost:${address.port}/admin/queues`);
        if (res.status !== 401) {
          throw new Error(`Expected HTTP 401 Unauthorized for unauthenticated dashboard access, got ${res.status}`);
        }
      } finally {
        server.close();
      }
    });
  } finally {
    await redisConnection.quit();
  }

  console.log(`\n📊 BullMQ Dashboard Test Results: ${passedCount}/${totalCount} PASSED`);
  if (passedCount < totalCount) {
    process.exit(1);
  }
}

runDashboardTests().catch((err) => {
  console.error('Unhandled failure in dashboard.test.ts:', err);
  process.exit(1);
});
