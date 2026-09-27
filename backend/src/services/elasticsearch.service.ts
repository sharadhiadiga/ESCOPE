import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env';

export const EMAIL_INDEX_NAME = 'emails';

export interface IndexedEmailDoc {
  scheduledEmailId: string;
  campaignId: string;
  userId: string;
  recipientEmail: string;
  recipientName?: string | null;
  subject: string;
  body: string;
  status: string;
  scheduledAt: Date | string;
  sentAt?: Date | string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

let esClientInstance: Client | null = null;

export function getElasticsearchClient(): Client {
  if (!esClientInstance) {
    esClientInstance = new Client({
      node: env.ELASTICSEARCH_URL || 'http://localhost:9200',
    });
  }
  return esClientInstance;
}

export class ElasticsearchService {
  private static isInitialized = false;

  /**
   * Safely initialize the `emails` index with mappings if it does not already exist.
   * Does NOT recreate or destroy existing index.
   */
  static async initializeIndex(): Promise<boolean> {
    try {
      const client = getElasticsearchClient();
      const exists = await client.indices.exists({ index: EMAIL_INDEX_NAME });

      if (!exists) {
        console.log(`[Elasticsearch] Index '${EMAIL_INDEX_NAME}' does not exist. Creating...`);
        await client.indices.create({
          index: EMAIL_INDEX_NAME,
          mappings: {
            properties: {
              scheduledEmailId: { type: 'keyword' },
              campaignId: { type: 'keyword' },
              userId: { type: 'keyword' },
              recipientEmail: {
                type: 'text',
                fields: { keyword: { type: 'keyword' } },
              },
              recipientName: {
                type: 'text',
                fields: { keyword: { type: 'keyword' } },
              },
              subject: { type: 'text' },
              body: { type: 'text' },
              status: { type: 'keyword' },
              scheduledAt: { type: 'date' },
              sentAt: { type: 'date' },
              createdAt: { type: 'date' },
              updatedAt: { type: 'date' },
            },
          },
        });
        console.log(`[Elasticsearch] ✅ Index '${EMAIL_INDEX_NAME}' created successfully.`);
      }
      ElasticsearchService.isInitialized = true;
      return true;
    } catch (err: any) {
      console.warn(`[Elasticsearch] Safe initialization warning (non-blocking): ${err?.message || err}`);
      return false;
    }
  }

  /**
   * Ensure index exists before write operations.
   */
  private static async ensureIndex(): Promise<void> {
    if (!ElasticsearchService.isInitialized) {
      await ElasticsearchService.initializeIndex();
    }
  }

  /**
   * Index or full upsert of an email document.
   * Non-blocking: Elasticsearch failure will log a warning and return false without throwing.
   */
  static async indexEmail(doc: IndexedEmailDoc, refresh: boolean = false): Promise<boolean> {
    try {
      await ElasticsearchService.ensureIndex();
      const client = getElasticsearchClient();
      await client.index({
        index: EMAIL_INDEX_NAME,
        id: doc.scheduledEmailId,
        document: {
          ...doc,
          scheduledAt: doc.scheduledAt instanceof Date ? doc.scheduledAt.toISOString() : doc.scheduledAt,
          sentAt: doc.sentAt instanceof Date ? doc.sentAt.toISOString() : doc.sentAt || null,
          createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        refresh: refresh ? 'wait_for' : false,
      });
      console.log(`[Elasticsearch] 🔍 Indexed email ${doc.scheduledEmailId} (Status: ${doc.status})`);
      return true;
    } catch (err: any) {
      console.warn(`[Elasticsearch] Failed to index email ${doc.scheduledEmailId} (non-blocking): ${err?.message || err}`);
      return false;
    }
  }

  /**
   * Partial update of email document status or other fields.
   * Non-blocking: Elasticsearch failure will log a warning and return false without throwing.
   */
  static async updateEmailStatus(
    scheduledEmailId: string,
    status: string,
    extraFields: Partial<IndexedEmailDoc> = {},
    refresh: boolean = false
  ): Promise<boolean> {
    try {
      await ElasticsearchService.ensureIndex();
      const client = getElasticsearchClient();
      const updateDoc: Record<string, any> = {
        status,
        updatedAt: new Date().toISOString(),
      };

      if (extraFields.sentAt) {
        updateDoc.sentAt = extraFields.sentAt instanceof Date ? extraFields.sentAt.toISOString() : extraFields.sentAt;
      }

      await client.update({
        index: EMAIL_INDEX_NAME,
        id: scheduledEmailId,
        doc: updateDoc,
        doc_as_upsert: true,
        refresh: refresh ? 'wait_for' : false,
      });
      console.log(`[Elasticsearch] 🔄 Updated email ${scheduledEmailId} status to '${status}'`);
      return true;
    } catch (err: any) {
      console.warn(`[Elasticsearch] Failed to update email ${scheduledEmailId} (non-blocking): ${err?.message || err}`);
      return false;
    }
  }

  /**
   * Full-text search across emails belonging strictly to the authenticated user.
   */
  static async searchEmails(
    userId: string,
    query?: string,
    limit: number = 50
  ): Promise<{ results: IndexedEmailDoc[]; total: number }> {
    try {
      await ElasticsearchService.ensureIndex();
      const client = getElasticsearchClient();
      const cleanQuery = query ? query.trim() : '';

      const boolQuery: any = {
        filter: [{ term: { userId } }],
      };

      if (cleanQuery) {
        boolQuery.must = [
          {
            multi_match: {
              query: cleanQuery,
              fields: ['subject^3', 'body', 'recipientEmail^2', 'recipientName^2'],
              fuzziness: 'AUTO',
            },
          },
        ];
      }

      const response = await client.search<IndexedEmailDoc>({
        index: EMAIL_INDEX_NAME,
        query: {
          bool: boolQuery,
        },
        sort: [{ scheduledAt: { order: 'desc' } }],
        size: limit,
      });

      const totalHits = typeof response.hits.total === 'number' ? response.hits.total : response.hits.total?.value || 0;
      const results = response.hits.hits.map((hit) => hit._source as IndexedEmailDoc);

      return {
        results,
        total: totalHits,
      };
    } catch (err: any) {
      console.warn(`[Elasticsearch] Search query failed: ${err?.message || err}`);
      return {
        results: [],
        total: 0,
      };
    }
  }
}
