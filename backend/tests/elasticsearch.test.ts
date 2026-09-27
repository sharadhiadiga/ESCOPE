process.env.NODE_ENV = 'test';
import { ElasticsearchService, IndexedEmailDoc } from '../src/services/elasticsearch.service';
import { UserService } from '../src/services/user.service';
import { prisma } from '../src/db';

async function runElasticsearchTests() {
  console.log('🧪 Starting Phase 8A Elasticsearch Email Search Tests...\n');
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
    userA = await UserService.createUser({
      email: `es_usera_${testRunId}@example.com`,
      name: 'ES User A',
    });

    userB = await UserService.createUser({
      email: `es_userb_${testRunId}@example.com`,
      name: 'ES User B',
    });

    // 1. Connection & Index Initialization
    await test('1. Elasticsearch index initialization executes safely', async () => {
      const success = await ElasticsearchService.initializeIndex();
      if (!success) {
        throw new Error('initializeIndex returned false');
      }
    });

    // 2. Indexing an Email Document
    const emailAId = `es_email_a_${testRunId}`;
    await test('2. Can index an email document into Elasticsearch', async () => {
      const docA: IndexedEmailDoc = {
        scheduledEmailId: emailAId,
        campaignId: `camp_${testRunId}`,
        userId: userA.id,
        recipientEmail: 'alice@partnercompany.com',
        recipientName: 'Alice Partner',
        subject: 'Phase 8 Elasticsearch Launch Plan',
        body: 'Here is the comprehensive search implementation documentation for Outbox Labs.',
        status: 'QUEUED',
        scheduledAt: new Date(),
        createdAt: new Date(),
      };

      const indexed = await ElasticsearchService.indexEmail(docA, true);
      if (!indexed) {
        throw new Error('Failed to index document A');
      }
    });

    // 3. Updating Email Status
    await test('3. Can update email status to SENT in Elasticsearch', async () => {
      const updated = await ElasticsearchService.updateEmailStatus(
        emailAId,
        'SENT',
        { sentAt: new Date() },
        true
      );
      if (!updated) {
        throw new Error('Failed to update email status');
      }
    });

    // 4. Full-Text Search Across Fields
    await test('4. Full-text search finds email by subject, body, and recipient', async () => {
      // Search by subject term
      const searchSubject = await ElasticsearchService.searchEmails(userA.id, 'Elasticsearch');
      if (searchSubject.total === 0 || !searchSubject.results.some((e) => e.scheduledEmailId === emailAId)) {
        throw new Error('Search by subject term failed to find email');
      }

      // Search by recipient email
      const searchRecipient = await ElasticsearchService.searchEmails(userA.id, 'partnercompany.com');
      if (searchRecipient.total === 0 || !searchRecipient.results.some((e) => e.scheduledEmailId === emailAId)) {
        throw new Error('Search by recipient email failed to find email');
      }

      // Search by body term
      const searchBody = await ElasticsearchService.searchEmails(userA.id, 'Outbox Labs');
      if (searchBody.total === 0 || !searchBody.results.some((e) => e.scheduledEmailId === emailAId)) {
        throw new Error('Search by body term failed to find email');
      }
    });

    // 5. Tenant / User Isolation
    await test('5. Tenant isolation prevents User B from seeing User A emails', async () => {
      // Index email for User B with the exact same keywords
      const emailBId = `es_email_b_${testRunId}`;
      const docB: IndexedEmailDoc = {
        scheduledEmailId: emailBId,
        campaignId: `camp_${testRunId}`,
        userId: userB.id,
        recipientEmail: 'bob@partnercompany.com',
        recipientName: 'Bob Secret',
        subject: 'Phase 8 Elasticsearch Launch Plan',
        body: 'Here is User B documentation.',
        status: 'QUEUED',
        scheduledAt: new Date(),
        createdAt: new Date(),
      };
      await ElasticsearchService.indexEmail(docB, true);

      // Search as User A -> Should only see User A's email
      const userASearch = await ElasticsearchService.searchEmails(userA.id, 'Elasticsearch');
      if (userASearch.results.some((e) => e.userId !== userA.id)) {
        throw new Error('User A search returned documents belonging to another user');
      }

      // Search as User B -> Should only see User B's email
      const userBSearch = await ElasticsearchService.searchEmails(userB.id, 'Elasticsearch');
      if (userBSearch.results.some((e) => e.userId !== userB.id)) {
        throw new Error('User B search returned documents belonging to another user');
      }

      if (userBSearch.results.some((e) => e.scheduledEmailId === emailAId)) {
        throw new Error('User B was able to view User A email (Tenant leak!)');
      }
    });

    // 6. Graceful Failure Handling
    await test('6. Elasticsearch service handles errors gracefully without throwing', async () => {
      // Searching with non-existent / empty query returns clean empty result or user documents
      const searchEmpty = await ElasticsearchService.searchEmails(userA.id, '');
      if (!Array.isArray(searchEmpty.results)) {
        throw new Error('Expected results to be an array even for empty query');
      }

      // Invalid status update should be handled without crashing process
      const updateResult = await ElasticsearchService.updateEmailStatus(
        'non_existent_id_99999',
        'FAILED',
        {},
        true
      );
      // Update with doc_as_upsert is true, so it succeeds or returns true/false without throwing
      if (typeof updateResult !== 'boolean') {
        throw new Error('Expected boolean return from updateEmailStatus');
      }
    });
  } finally {
    // Cleanup test users from DB
    if (userA) await prisma.user.delete({ where: { id: userA.id } }).catch(() => {});
    if (userB) await prisma.user.delete({ where: { id: userB.id } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(`\n📊 Elasticsearch Test Results: ${passedCount}/${totalCount} PASSED`);
  if (passedCount < totalCount) {
    process.exit(1);
  }
}

runElasticsearchTests().catch((err) => {
  console.error('Unhandled failure in elasticsearch.test.ts:', err);
  process.exit(1);
});
