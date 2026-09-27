import { prisma, EmailStatus, DeliveryEventType, CampaignStatus } from '../db';
import { addScheduledEmailJob } from '../queues/email.queue';
import { z } from 'zod';

export const scheduleEmailSchema = z.object({
  campaignId: z.string().uuid(),
  recipientEmail: z.string().email(),
  recipientName: z.string().optional(),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
  scheduledAt: z.coerce.date().refine((date) => !isNaN(date.getTime()), {
    message: 'Invalid scheduledAt date format',
  }),
  idempotencyKey: z.string().optional(),
});

export type ScheduleEmailInput = z.infer<typeof scheduleEmailSchema>;

export class EmailSchedulingService {
  static async scheduleEmail(userId: string, input: ScheduleEmailInput) {
    const validated = scheduleEmailSchema.parse(input);

    // 1. Verify Campaign exists and belongs to authenticated user
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: validated.campaignId,
        userId,
      },
      include: {
        senderAccount: true,
      },
    });

    if (!campaign) {
      throw new Error('Campaign not found or does not belong to the authenticated user');
    }

    if (!campaign.senderAccount || campaign.senderAccount.userId !== userId) {
      throw new Error('Campaign sender account not found or unauthorized');
    }

    // 2. Reject scheduling in the far past (allow 10 second buffer for latency)
    const now = Date.now();
    const scheduledTime = validated.scheduledAt.getTime();
    if (scheduledTime < now - 10000) {
      throw new Error('Cannot schedule an email in the past');
    }

    // 3. Generate deterministic idempotencyKey if not provided
    const idempotencyKey =
      validated.idempotencyKey ||
      `idempotency_${validated.campaignId}_${validated.recipientEmail.toLowerCase()}_${scheduledTime}`;

    // 4. Idempotency Check: Return existing record if already scheduled
    const existingEmail = await prisma.scheduledEmail.findUnique({
      where: { idempotencyKey },
    });

    if (existingEmail) {
      return {
        scheduledEmailId: existingEmail.id,
        queueJobId: existingEmail.queueJobId || `email:${existingEmail.id}`,
        scheduledAt: existingEmail.scheduledAt,
        status: existingEmail.status,
        isDuplicate: true,
      };
    }

    // 5. Calculate BullMQ delay
    const delayMs = Math.max(0, scheduledTime - Date.now());

    // 6. Create PostgreSQL ScheduledEmail record
    const scheduledEmail = await prisma.scheduledEmail.create({
      data: {
        campaignId: campaign.id,
        recipientEmail: validated.recipientEmail.toLowerCase(),
        recipientName: validated.recipientName || null,
        subject: validated.subject,
        body: validated.body,
        scheduledAt: validated.scheduledAt,
        status: EmailStatus.SCHEDULED,
        idempotencyKey,
      },
    });

    // Log initial schedule event
    await prisma.deliveryLog.create({
      data: {
        scheduledEmailId: scheduledEmail.id,
        eventType: DeliveryEventType.QUEUED,
        metadata: {
          scheduledAt: validated.scheduledAt.toISOString(),
          delayMs,
        },
      },
    });

    // Update campaign status to SCHEDULED/PROCESSING if DRAFT
    if (campaign.status === CampaignStatus.DRAFT) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: CampaignStatus.SCHEDULED },
      });
    }

    // 7. Enqueue Delayed BullMQ Job
    try {
      const job = await addScheduledEmailJob(
        {
          scheduledEmailId: scheduledEmail.id,
          campaignId: campaign.id,
          idempotencyKey: scheduledEmail.idempotencyKey,
        },
        delayMs
      );

      // Update ScheduledEmail with queueJobId and status QUEUED
      const updatedEmail = await prisma.scheduledEmail.update({
        where: { id: scheduledEmail.id },
        data: {
          queueJobId: job.id,
          status: EmailStatus.QUEUED,
        },
      });

      return {
        scheduledEmailId: updatedEmail.id,
        queueJobId: job.id,
        scheduledAt: updatedEmail.scheduledAt,
        status: updatedEmail.status,
        isDuplicate: false,
      };
    } catch (err: any) {
      // Handle queue creation failure cleanly
      const errorMessage = err?.message || 'Failed to enqueue BullMQ job';
      await prisma.scheduledEmail.update({
        where: { id: scheduledEmail.id },
        data: {
          status: EmailStatus.FAILED,
          errorMessage,
        },
      });

      await prisma.deliveryLog.create({
        data: {
          scheduledEmailId: scheduledEmail.id,
          eventType: DeliveryEventType.FAILED,
          metadata: { error: errorMessage },
        },
      });

      throw new Error(`Scheduling failed: ${errorMessage}`);
    }
  }
}
