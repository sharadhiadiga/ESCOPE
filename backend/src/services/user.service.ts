import { prisma } from '../db';
import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  googleId: z.string().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export class UserService {
  static async createUser(input: CreateUserInput) {
    const validated = createUserSchema.parse(input);
    return prisma.user.create({
      data: validated,
    });
  }

  static async findUserByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
    });
  }

  static async findUserById(id: string) {
    return prisma.user.findUnique({
      where: { id },
    });
  }

  static async findUserByGoogleId(googleId: string) {
    return prisma.user.findUnique({
      where: { googleId },
    });
  }

  static async findOrCreateGoogleUser(profile: {
    googleId: string;
    email: string;
    name?: string;
    avatarUrl?: string;
  }) {
    // 1. Find by googleId
    let user = await prisma.user.findUnique({
      where: { googleId: profile.googleId },
    });
    if (user) return user;

    // 2. Find by email
    user = await prisma.user.findUnique({
      where: { email: profile.email },
    });

    if (user) {
      return prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: profile.googleId,
          avatarUrl: user.avatarUrl || profile.avatarUrl,
          name: user.name || profile.name,
        },
      });
    }

    // 3. Create new user
    return prisma.user.create({
      data: {
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        googleId: profile.googleId,
      },
    });
  }
}
