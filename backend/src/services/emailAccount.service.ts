import { prisma } from '../db';
import { z } from 'zod';

export const createEmailAccountSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().optional(),
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().positive(),
  smtpUser: z.string().min(1),
  smtpPassword: z.string().min(1),
  provider: z.string().default('ethereal'),
});

export type CreateEmailAccountInput = z.infer<typeof createEmailAccountSchema>;

export class EmailAccountService {
  static async createEmailAccount(input: CreateEmailAccountInput) {
    const validated = createEmailAccountSchema.parse(input);
    return prisma.emailAccount.create({
      data: validated,
      select: {
        id: true,
        userId: true,
        email: true,
        displayName: true,
        smtpHost: true,
        smtpPort: true,
        smtpUser: true,
        provider: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  static async findAccountsByUserId(userId: string) {
    return prisma.emailAccount.findMany({
      where: { userId },
      select: {
        id: true,
        userId: true,
        email: true,
        displayName: true,
        smtpHost: true,
        smtpPort: true,
        smtpUser: true,
        provider: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        // Exclude smtpPassword from API/default queries for security
      },
    });
  }

  static async getAccountWithCredentials(id: string) {
    return prisma.emailAccount.findUnique({
      where: { id },
    });
  }
}
