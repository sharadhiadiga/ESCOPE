import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { EmailAccountController } from '../controllers/emailAccount.controller';

const router = Router();

// GET /api/email-accounts (Authenticated)
router.get('/', requireAuth, EmailAccountController.listAccounts);

export default router;
