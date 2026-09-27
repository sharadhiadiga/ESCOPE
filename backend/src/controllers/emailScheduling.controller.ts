import { Request, Response } from 'express';
import { EmailSchedulingService } from '../services/emailScheduling.service';
import { AuthenticatedUser } from '../middleware/auth';

export class EmailSchedulingController {
  static async scheduleEmail(req: Request, res: Response) {
    try {
      const user = req.user as AuthenticatedUser;
      if (!user || !user.id) {
        return res.status(401).json({
          success: false,
          error: { message: 'Unauthorized: Authentication required' },
        });
      }

      const result = await EmailSchedulingService.scheduleEmail(user.id, req.body);
      return res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      const isNotFound = err.message?.toLowerCase().includes('not found');
      const statusCode = isNotFound ? 404 : 400;
      return res.status(statusCode).json({
        success: false,
        error: {
          message: err.message || 'Failed to schedule email',
        },
      });
    }
  }
}
