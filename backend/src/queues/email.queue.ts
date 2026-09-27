import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

export const EMAIL_QUEUE_NAME = process.env.NODE_ENV === 'test' ? 'email-scheduling-test' : 'email-scheduling';

export interface EmailJobData {
  scheduledEmailId: string;
  campaignId: string;
  idempotencyKey: string;
}

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 1,
  },
});

export async function addScheduledEmailJob(data: EmailJobData, delayMs: number) {
  const sanitizeId = data.scheduledEmailId.replace(/:/g, '_');
  const jobId = `email_${sanitizeId}`;
  return emailQueue.add('send-email', data, {
    jobId,
    delay: Math.max(0, Math.floor(delayMs)),
  });
}
