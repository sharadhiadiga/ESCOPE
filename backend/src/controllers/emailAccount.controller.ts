import { Request, Response } from 'express';
import { EmailAccountService } from '../services/emailAccount.service';
import { AuthenticatedUser } from '../middleware/auth';

export class EmailAccountController {
  static async listAccounts(req: Request, res: Response) {
    try {
      const user = req.user as AuthenticatedUser;
      if (!user || !user.id) {
        return res.status(401).json({
          success: false,
          error: { message: 'Unauthorized: Authentication required' },
        });
      }

      const accounts = await EmailAccountService.ensureUserAccount(user.id, user.email);

      return res.status(200).json({
        success: true,
        data: accounts,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: { message: err.message || 'Failed to fetch email accounts' },
      });
    }
  }
}
