import { Worker, Job } from 'bullmq';
import { EMAIL_QUEUE_NAME, EmailJobData, addScheduledEmailJob } from '../queues/email.queue';
import { redisConnection } from '../config/redis';
import { env } from '../config/env';
import { prisma, EmailStatus, DeliveryEventType } from '../db';
import { EmailDeliveryService } from '../services/emailDelivery.service';
import { EmailAccountService } from '../services/emailAccount.service';
import { RateLimiterService } from '../services/rateLimiter.service';
import { SlackNotificationService } from '../services/slackNotification.service';

export function createEmailWorker() {
  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobData>) => {
      const { scheduledEmailId } = job.data;
      console.log(`\n[Worker] Processing Job ${job.id} for Scheduled Email ${scheduledEmailId}`);

      // 1. Fetch ScheduledEmail from PostgreSQL
      const scheduledEmail = await prisma.scheduledEmail.findUnique({
        where: { id: scheduledEmailId },
        include: {
          campaign: true,
        },
      });

      if (!scheduledEmail) {
        console.warn(`[Worker] ScheduledEmail ${scheduledEmailId} not found in database. Skipping.`);
        return;
      }

      // 2. Idempotency Check: Skip if already SENT
      if (scheduledEmail.status === EmailStatus.SENT) {
        console.log(`[Worker] Email ${scheduledEmailId} already SENT. Skipping to enforce idempotency.`);
        return;
      }

      // 3. Atomic State Transition: SCHEDULED/QUEUED -> PROCESSING
      const claimResult = await prisma.scheduledEmail.updateMany({
        where: {
          id: scheduledEmailId,
          status: {
            notIn: [EmailStatus.SENT, EmailStatus.PROCESSING],
          },
        },
        data: {
          status: EmailStatus.PROCESSING,
          attemptCount: { increment: 1 },
        },
      });

      if (claimResult.count === 0) {
        console.log(`[Worker] Email ${scheduledEmailId} could not be claimed (already SENT or PROCESSING by another worker).`);
        return;
      }

      // Log PROCESSING state transition
      await prisma.deliveryLog.create({
        data: {
          scheduledEmailId,
          eventType: DeliveryEventType.PROCESSING,
          metadata: { jobId: job.id, attemptCount: scheduledEmail.attemptCount + 1 },
        },
      });

      // 4. Load full sender credentials securely from DB for SMTP connection
      const senderAccount = await EmailAccountService.getAccountWithCredentials(
        scheduledEmail.campaign.senderAccountId
      );

      if (!senderAccount) {
        throw new Error('Sender email account credentials not found in database');
      }

      // 5. Atomic Rate Limiting & Throttling Check
      const hourlyLimit = scheduledEmail.campaign.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR;
      const delayBetweenEmailsMs = scheduledEmail.campaign.delayBetweenEmailsMs ?? env.MIN_DELAY_BETWEEN_EMAILS_MS;

      const rateLimitRes = await RateLimiterService.reserveSendPermission({
        campaignId: scheduledEmail.campaign.id,
        senderAccountId: scheduledEmail.campaign.senderAccountId,
        hourlyLimit,
        delayBetweenEmailsMs,
      });

      if (!rateLimitRes.allowed) {
        const retryAfterMs = rateLimitRes.retryAfterMs || 2000;
        console.warn(
          `[Worker] ⏳ Rate limit hit (${rateLimitRes.reason}) for email ${scheduledEmailId}. Rescheduling in ${retryAfterMs}ms.`
        );

        // Revert status to QUEUED so it remains pending
        await prisma.scheduledEmail.update({
          where: { id: scheduledEmailId },
          data: { status: EmailStatus.QUEUED },
        });

        // Log RESCHEDULED delivery log
        await prisma.deliveryLog.create({
          data: {
            scheduledEmailId,
            eventType: DeliveryEventType.RESCHEDULED,
            metadata: {
              reason: rateLimitRes.reason,
              retryAfterMs,
              jobId: job.id,
            },
          },
        });

        // Trigger optional Slack notification if hourly limit reached
        if (rateLimitRes.reason === 'HOURLY_LIMIT') {
          await SlackNotificationService.notifyRateLimitExceeded({
            userId: scheduledEmail.campaign.userId,
            campaignId: scheduledEmail.campaign.id,
            campaignName: scheduledEmail.campaign.name,
            hourlyLimit,
            retryAfterMs,
          });
        }

        // Remove active job and re-enqueue in BullMQ with delay
        await job.remove().catch(() => {});
        await addScheduledEmailJob(
          {
            scheduledEmailId: scheduledEmail.id,
            campaignId: scheduledEmail.campaignId,
            idempotencyKey: scheduledEmail.idempotencyKey,
          },
          retryAfterMs
        );

        return;
      }

      // 6. Execute Real Email Delivery via Nodemailer Ethereal Provider
      try {
        const deliveryResult = await EmailDeliveryService.sendEmail({
          to: scheduledEmail.recipientEmail,
          recipientName: scheduledEmail.recipientName,
          subject: scheduledEmail.subject,
          body: scheduledEmail.body,
          senderAccount: {
            id: senderAccount.id,
            email: senderAccount.email,
            displayName: senderAccount.displayName,
            smtpHost: senderAccount.smtpHost,
            smtpPort: senderAccount.smtpPort,
            smtpUser: senderAccount.smtpUser,
            smtpPassword: senderAccount.smtpPassword,
          },
        });

        const sentAt = new Date();

        // 7. State Transition on Success: PROCESSING -> SENT
        await prisma.scheduledEmail.update({
          where: { id: scheduledEmailId },
          data: {
            status: EmailStatus.SENT,
            sentAt,
          },
        });

        // Log SENT delivery log with safe metadata (no credentials, includes previewUrl if available)
        await prisma.deliveryLog.create({
          data: {
            scheduledEmailId,
            eventType: DeliveryEventType.SENT,
            metadata: {
              messageId: deliveryResult.messageId,
              accepted: deliveryResult.accepted,
              rejected: deliveryResult.rejected,
              previewUrl: deliveryResult.previewUrl || null,
              jobId: job.id,
              sentAt: sentAt.toISOString(),
            },
          },
        });

        console.log(`[Worker] ✅ Successfully delivered email ${scheduledEmailId} to ${scheduledEmail.recipientEmail}`);
        if (deliveryResult.previewUrl) {
          console.log(`[Worker] ✉️  Ethereal Preview URL: ${deliveryResult.previewUrl}`);
        }
      } catch (err: any) {
        const errorMessage = err?.message || 'Unknown error during email delivery execution';
        console.error(`[Worker] ❌ Failed to deliver email ${scheduledEmailId}: ${errorMessage}`);

        // 8. State Transition on Failure: PROCESSING -> FAILED
        await prisma.scheduledEmail.update({
          where: { id: scheduledEmailId },
          data: {
            status: EmailStatus.FAILED,
            errorMessage,
          },
        });

        // Log FAILED delivery log
        await prisma.deliveryLog.create({
          data: {
            scheduledEmailId,
            eventType: DeliveryEventType.FAILED,
            metadata: {
              error: errorMessage,
              jobId: job.id,
            },
          },
        });

        throw err;
      }
    },
    {
      connection: redisConnection,
      concurrency: env.WORKER_CONCURRENCY || 5,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[Worker Event] Job ${job?.id} failed with error: ${err.message}`);
  });

  worker.on('completed', (job) => {
    console.log(`[Worker Event] Job ${job.id} completed successfully.`);
  });

  return worker;
}
