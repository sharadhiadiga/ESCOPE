import { UserService } from '../src/services/user.service';
import { requireAuth } from '../src/middleware/auth';
import { prisma } from '../src/db';

async function runAuthTests() {
  console.log('🧪 Starting Phase 3 Auth Infrastructure Integration Tests...\n');
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
  const testEmail = `auth_test_${testRunId}@example.com`;
  const googleId = `google_sub_${testRunId}`;

  try {
    // 1. User Creation via findOrCreateGoogleUser
    let createdUser: any;
    await test('1. Google User Creation (findOrCreateGoogleUser)', async () => {
      createdUser = await UserService.findOrCreateGoogleUser({
        googleId,
        email: testEmail,
        name: 'OAuth User',
        avatarUrl: 'https://example.com/avatar.jpg',
      });
      if (!createdUser.id || createdUser.googleId !== googleId || createdUser.email !== testEmail) {
        throw new Error('findOrCreateGoogleUser failed to create user');
      }
    });

    // 2. Prevent Duplicate User Creation for same Google ID
    await test('2. Duplicate Google ID returns existing user', async () => {
      const sameUser = await UserService.findOrCreateGoogleUser({
        googleId,
        email: testEmail,
        name: 'OAuth User Updated',
      });
      if (sameUser.id !== createdUser.id) {
        throw new Error('Created duplicate user instead of returning existing user');
      }
    });

    // 3. Existing User (by email) association with Google ID
    const preExistingEmail = `existing_email_${testRunId}@example.com`;
    const newGoogleId = `google_sub_new_${testRunId}`;
    let preUser: any;
    await test('3. Associate existing email user with new Google ID', async () => {
      preUser = await UserService.createUser({
        email: preExistingEmail,
        name: 'Pre-existing User',
      });

      const updatedUser = await UserService.findOrCreateGoogleUser({
        googleId: newGoogleId,
        email: preExistingEmail,
        name: 'Pre-existing User',
        avatarUrl: 'https://example.com/new_avatar.png',
      });

      if (updatedUser.id !== preUser.id || updatedUser.googleId !== newGoogleId) {
        throw new Error('Failed to link googleId to existing email user');
      }
    });

    // 4. RequireAuth Middleware Rejection Test
    await test('4. requireAuth rejects unauthenticated requests with 401', async () => {
      let statusSent = 0;
      let jsonBody: any = null;
      const req: any = { isAuthenticated: () => false };
      const res: any = {
        status: (code: number) => {
          statusSent = code;
          return {
            json: (body: any) => {
              jsonBody = body;
            },
          };
        },
      };
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      requireAuth(req, res, next);
      if (nextCalled || statusSent !== 401 || !jsonBody?.error) {
        throw new Error('requireAuth did not reject unauthenticated request with 401');
      }
    });

    // 5. RequireAuth Middleware Pass Test
    await test('5. requireAuth allows authenticated requests', async () => {
      const req: any = { isAuthenticated: () => true, user: createdUser };
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      requireAuth(req, {} as any, next);
      if (!nextCalled) {
        throw new Error('requireAuth blocked authenticated request');
      }
    });

    // Cleanup test users
    console.log('\n🧹 Cleaning up test users...');
    await prisma.user.deleteMany({
      where: { id: { in: [createdUser.id, preUser.id] } },
    });
    console.log('✨ Cleanup complete.');

    console.log(`\n📊 Auth Test Results: ${passedCount}/${totalCount} tests passed.`);
    if (passedCount < totalCount) {
      process.exit(1);
    }
  } catch (globalErr) {
    console.error('Fatal error during auth test run:', globalErr);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runAuthTests();
