import { prisma, EmailStatus, DeliveryEventType } from '../db';
import { z } from 'zod';

export const createScheduledEmailSchema = z.object({
  campaignId: z.string().uuid(),
  recipientEmail: z.string().email(),
  recipientName: z.string().optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  scheduledAt: z.coerce.date(),
  idempotencyKey: z.string().min(1),
});

export type CreateScheduledEmailInput = z.infer<typeof createScheduledEmailSchema>;

export class ScheduledEmailService {
  static async createScheduledEmail(input: CreateScheduledEmailInput) {
    const validated = createScheduledEmailSchema.parse(input);
    return prisma.scheduledEmail.create({
      data: validated,
    });
  }

  static async updateScheduledEmailStatus(
    id: string,
    status: EmailStatus,
    options?: {
      errorMessage?: string;
      sentAt?: Date;
      queueJobId?: string;
      attemptCount?: number;
    }
  ) {
    const data: any = { status };
    if (options?.errorMessage !== undefined) data.errorMessage = options.errorMessage;
    if (options?.sentAt !== undefined) data.sentAt = options.sentAt;
    if (options?.queueJobId !== undefined) data.queueJobId = options.queueJobId;
    if (options?.attemptCount !== undefined) data.attemptCount = options.attemptCount;

    return prisma.scheduledEmail.update({
      where: { id },
      data,
    });
  }

  static async findScheduledEmailsByCampaign(campaignId: string) {
    return prisma.scheduledEmail.findMany({
      where: { campaignId },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  static async findEmailsByUser(userId: string, filter?: { status?: EmailStatus }) {
    return prisma.scheduledEmail.findMany({
      where: {
        campaign: {
          userId,
        },
        ...(filter?.status ? { status: filter.status } : {}),
      },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            subject: true,
          },
        },
      },
      orderBy: { scheduledAt: 'desc' },
    });
  }

  static async logDeliveryEvent(
    scheduledEmailId: string,
    eventType: DeliveryEventType,
    metadata?: Record<string, any>
  ) {
    return prisma.deliveryLog.create({
      data: {
        scheduledEmailId,
        eventType,
        metadata: metadata || undefined,
      },
    });
  }
}
