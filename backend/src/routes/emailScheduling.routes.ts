import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { EmailSchedulingController } from '../controllers/emailScheduling.controller';

const router = Router();

// POST /api/emails/schedule (Authenticated)
router.post('/schedule', requireAuth, EmailSchedulingController.scheduleEmail);

export default router;
