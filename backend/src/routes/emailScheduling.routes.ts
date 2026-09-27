import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { EmailSchedulingController } from '../controllers/emailScheduling.controller';
import { EmailSearchController } from '../controllers/emailSearch.controller';

const router = Router();

// GET /api/emails & /api/emails/list (Authenticated)
router.get('/', requireAuth, EmailSchedulingController.listEmails);
router.get('/list', requireAuth, EmailSchedulingController.listEmails);

// POST /api/emails/schedule & /api/emails/campaign (Authenticated)
router.post('/schedule', requireAuth, EmailSchedulingController.scheduleEmail);
router.post('/campaign', requireAuth, EmailSchedulingController.scheduleCampaign);

// GET /api/emails/search (Authenticated)
router.get('/search', requireAuth, EmailSearchController.searchEmails);

export default router;
