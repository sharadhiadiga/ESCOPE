import React from 'react';
import { EmailItem } from '../types/email';
import { StatusBadge } from './StatusBadge';
import { Calendar, User, Tag } from 'lucide-react';

interface EmailTableProps {
  emails: EmailItem[];
  type: 'scheduled' | 'sent' | 'all';
}

export const EmailTable: React.FC<EmailTableProps> = ({ emails, type }) => {
  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-left text-xs">
        <thead className="bg-gray-50/80 text-gray-500 font-semibold border-b border-gray-200 uppercase tracking-wider text-[11px]">
          <tr>
            <th className="py-3 px-4">Recipient</th>
            <th className="py-3 px-4">Subject & Preview</th>
            <th className="py-3 px-4">Campaign</th>
            <th className="py-3 px-4">Status</th>
            <th className="py-3 px-4">{type === 'sent' ? 'Sent Time' : 'Scheduled Time'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-gray-800">
          {emails.map((email) => {
            const emailId = email.id || email.scheduledEmailId || `email_${Math.random()}`;
            const campaignName = email.campaign?.name || 'Default Campaign';
            const displayTime = type === 'sent' && email.sentAt ? email.sentAt : email.scheduledAt;

            return (
              <tr
                key={emailId}
                className="hover:bg-gray-50 transition-colors duration-150 group"
              >
                {/* Recipient */}
                <td className="py-3 px-4 font-medium text-gray-900">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center font-bold text-[10px] shrink-0">
                      {email.recipientName ? email.recipientName[0].toUpperCase() : <User className="w-3.5 h-3.5" />}
                    </div>
                    <div>
                      {email.recipientName && (
                        <p className="text-gray-900 font-semibold leading-tight">{email.recipientName}</p>
                      )}
                      <p className="text-gray-500 text-[11px] leading-tight">{email.recipientEmail}</p>
                    </div>
                  </div>
                </td>

                {/* Subject & Preview */}
                <td className="py-3 px-4 max-w-xs">
                  <p className="text-gray-900 font-medium group-hover:text-emerald-700 transition-colors truncate">
                    {email.subject}
                  </p>
                  <p className="text-gray-500 text-[11px] truncate mt-0.5">{email.body}</p>
                </td>

                {/* Campaign */}
                <td className="py-3 px-4 text-gray-600">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-100 border border-gray-200 text-gray-700 text-[11px]">
                    <Tag className="w-3 h-3 text-emerald-600" />
                    {campaignName}
                  </span>
                </td>

                {/* Status */}
                <td className="py-3 px-4">
                  <StatusBadge status={email.status} />
                </td>

                {/* Time */}
                <td className="py-3 px-4 text-gray-500 whitespace-nowrap">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                    {formatDate(displayTime)}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

