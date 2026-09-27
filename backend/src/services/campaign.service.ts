import { prisma, CampaignStatus } from '../db';
import { z } from 'zod';

export const createCampaignSchema = z.object({
  userId: z.string().uuid(),
  senderAccountId: z.string().uuid(),
  name: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  startAt: z.coerce.date(),
  delayBetweenEmailsMs: z.number().int().min(0).default(2000),
  hourlyLimit: z.number().int().positive().default(200),
  status: z.nativeEnum(CampaignStatus).optional(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export class CampaignService {
  static async createCampaign(input: CreateCampaignInput) {
    const validated = createCampaignSchema.parse(input);
    return prisma.campaign.create({
      data: {
        ...validated,
        status: validated.status || CampaignStatus.SCHEDULED,
      },
    });
  }

  static async findCampaignsByUserId(userId: string) {
    return prisma.campaign.findMany({
      where: { userId },
      include: {
        senderAccount: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
        _count: {
          select: { scheduledEmails: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async findCampaignById(id: string) {
    return prisma.campaign.findUnique({
      where: { id },
      include: {
        senderAccount: true,
        scheduledEmails: true,
      },
    });
  }

  static async updateCampaignStatus(id: string, status: CampaignStatus) {
    return prisma.campaign.update({
      where: { id },
      data: { status },
    });
  }
}
