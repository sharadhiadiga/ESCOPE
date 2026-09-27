import nodemailer from 'nodemailer';

export interface SenderAccountCredentials {
  id: string;
  email: string;
  displayName?: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
}

export interface EmailPayload {
  to: string;
  recipientName?: string | null;
  subject: string;
  body: string;
  senderAccount: SenderAccountCredentials;
}

export interface DeliveryResult {
  success: boolean;
  messageId: string;
  accepted: string[];
  rejected: string[];
  previewUrl?: string | null;
}

export class EmailDeliveryService {
  /**
   * Real email delivery service using Nodemailer + Ethereal SMTP.
   * Dynamically constructs a transporter per campaign sender account.
   */
  static async sendEmail(payload: EmailPayload): Promise<DeliveryResult> {
    const { senderAccount } = payload;

    if (!senderAccount || !senderAccount.smtpHost || !senderAccount.smtpUser) {
      throw new Error('Invalid or missing SMTP sender account configuration.');
    }

    console.log(
      `[SMTP Delivery] Initiating delivery to: ${payload.to} via SMTP Host: ${senderAccount.smtpHost}:${senderAccount.smtpPort} (Sender: ${senderAccount.email})`
    );

    // Create Nodemailer Transporter per sender account to support multi-tenant senders
    const transporter = nodemailer.createTransport({
      host: senderAccount.smtpHost,
      port: senderAccount.smtpPort,
      secure: senderAccount.smtpPort === 465,
      auth: {
        user: senderAccount.smtpUser,
        pass: senderAccount.smtpPassword,
      },
    });

    const fromAddress = senderAccount.displayName
      ? `"${senderAccount.displayName}" <${senderAccount.email}>`
      : senderAccount.email;

    const info = await transporter.sendMail({
      from: fromAddress,
      to: payload.recipientName ? `"${payload.recipientName}" <${payload.to}>` : payload.to,
      subject: payload.subject,
      text: payload.body,
      html: payload.body.replace(/\n/g, '<br/>'),
    });

    let previewUrlString: string | null = null;
    try {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      previewUrlString = typeof previewUrl === 'string' ? previewUrl : null;
    } catch {
      previewUrlString = null;
    }

    if (previewUrlString) {
      console.log(`[Ethereal SMTP] ✉️ Preview URL: ${previewUrlString}`);
    }

    const accepted = Array.isArray(info.accepted)
      ? info.accepted.map((addr) => (typeof addr === 'string' ? addr : (addr as any).address || String(addr)))
      : [payload.to];

    const rejected = Array.isArray(info.rejected)
      ? info.rejected.map((addr) => (typeof addr === 'string' ? addr : (addr as any).address || String(addr)))
      : [];

    return {
      success: true,
      messageId: info.messageId || `msg_${Date.now()}`,
      accepted,
      rejected,
      previewUrl: previewUrlString,
    };
  }
}
