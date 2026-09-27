export type EmailStatusType =
  | 'SCHEDULED'
  | 'QUEUED'
  | 'PROCESSING'
  | 'SENT'
  | 'FAILED'
  | 'RESCHEDULED';

export interface EmailItem {
  id?: string;
  scheduledEmailId?: string;
  campaignId?: string;
  userId?: string;
  recipientEmail: string;
  recipientName?: string | null;
  subject: string;
  body: string;
  status: EmailStatusType;
  scheduledAt: string;
  sentAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  campaign?: {
    id: string;
    name?: string;
    subject?: string;
  };
}
