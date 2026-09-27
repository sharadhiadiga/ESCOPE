import { Request, Response } from 'express';
import { prisma } from '../db';
import { EmailSchedulingService } from '../services/emailScheduling.service';
import { ScheduledEmailService } from '../services/scheduledEmail.service';
import { CampaignService } from '../services/campaign.service';
import { EmailAccountService } from '../services/emailAccount.service';
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

  static async scheduleCampaign(req: Request, res: Response) {
    try {
      const user = req.user as AuthenticatedUser;
      if (!user || !user.id) {
        return res.status(401).json({
          success: false,
          error: { message: 'Unauthorized: Authentication required' },
        });
      }

      const {
        name,
        senderAccountId,
        subject,
        body,
        startAt,
        delayBetweenEmailsMs,
        hourlyLimit,
        leads,
      } = req.body;

      if (!name || !subject || !body || !leads || !Array.isArray(leads) || leads.length === 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'Missing required campaign parameters or empty leads list' },
        });
      }

      // Ensure user has valid sender account
      const accounts = await EmailAccountService.ensureUserAccount(user.id, user.email);
      let activeSenderId = senderAccountId;
      if (!activeSenderId || !accounts.some((a) => a.id === activeSenderId)) {
        activeSenderId = accounts[0].id;
      }

      const now = Date.now();
      const parsedStart = new Date(startAt || now).getTime();
      const startTimeMs = isNaN(parsedStart) ? now : Math.max(now, parsedStart);
      const campaignStartAt = new Date(startTimeMs);

      // 1. Create Campaign in DB
      const campaign = await CampaignService.createCampaign({
        userId: user.id,
        senderAccountId: activeSenderId,
        name,
        subject,
        body,
        startAt: campaignStartAt,
        delayBetweenEmailsMs: typeof delayBetweenEmailsMs === 'number' ? delayBetweenEmailsMs : 2000,
        hourlyLimit: typeof hourlyLimit === 'number' ? hourlyLimit : 200,
      });

      // 2. Schedule each lead sequentially spaced out by delayBetweenEmailsMs
      const scheduledResults = [];
      const interDelay = campaign.delayBetweenEmailsMs;

      try {
        for (let i = 0; i < leads.length; i++) {
          const lead = leads[i];
          const recipientEmail = lead.recipientEmail || lead.email;
          if (!recipientEmail) continue;

          const leadScheduledAt = new Date(startTimeMs + i * interDelay);

          const result = await EmailSchedulingService.scheduleEmail(user.id, {
            campaignId: campaign.id,
            recipientEmail,
            recipientName: lead.recipientName || lead.name || null,
            subject: campaign.subject,
            body: campaign.body,
            scheduledAt: leadScheduledAt,
          });

          scheduledResults.push(result);
        }

        if (scheduledResults.length === 0) {
          await prisma.campaign.delete({ where: { id: campaign.id } }).catch(() => {});
          return res.status(400).json({
            success: false,
            error: { message: 'No valid recipient leads could be scheduled' },
          });
        }

        return res.status(201).json({
          success: true,
          data: {
            campaignId: campaign.id,
            campaignName: campaign.name,
            totalLeads: leads.length,
            scheduledCount: scheduledResults.length,
            scheduledEmails: scheduledResults,
          },
        });
      } catch (err: any) {
        await prisma.campaign.delete({ where: { id: campaign.id } }).catch(() => {});
        throw err;
      }
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        error: { message: err.message || 'Failed to schedule campaign' },
      });
    }
  }

  static async listEmails(req: Request, res: Response) {
    try {
      const user = req.user as AuthenticatedUser;
      if (!user || !user.id) {
        return res.status(401).json({
          success: false,
          error: { message: 'Unauthorized: Authentication required' },
        });
      }

      const statusParam = typeof req.query.status === 'string' ? (req.query.status as any) : undefined;
      const emails = await ScheduledEmailService.findEmailsByUser(user.id, { status: statusParam });

      return res.status(200).json({
        success: true,
        data: emails,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: {
          message: err.message || 'Failed to fetch emails',
        },
      });
    }
  }
}
