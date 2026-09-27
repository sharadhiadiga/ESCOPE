import React from 'react';
import { Mail, Search, AlertCircle } from 'lucide-react';

interface EmptyStateProps {
  type: 'scheduled' | 'sent' | 'search' | 'error';
  title?: string;
  message?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ type, title, message }) => {
  let icon = <Mail className="w-8 h-8 text-gray-400" />;
  let defaultTitle = 'No emails found';
  let defaultMessage = 'There are no emails to display at this time.';

  if (type === 'scheduled') {
    icon = <Mail className="w-8 h-8 text-emerald-600" />;
    defaultTitle = 'No Scheduled Emails';
    defaultMessage = 'You currently have no pending emails queued for delivery.';
  } else if (type === 'sent') {
    icon = <Mail className="w-8 h-8 text-emerald-600" />;
    defaultTitle = 'No Sent Emails';
    defaultMessage = 'No emails have been delivered yet for your campaigns.';
  } else if (type === 'search') {
    icon = <Search className="w-8 h-8 text-emerald-600" />;
    defaultTitle = 'No Matching Search Results';
    defaultMessage = 'Try searching with a different term, email address, or subject keyword.';
  } else if (type === 'error') {
    icon = <AlertCircle className="w-8 h-8 text-amber-500" />;
    defaultTitle = 'Unable to Load Emails';
    defaultMessage = 'Failed to connect to search engine. Falling back to database view.';
  }

  return (
    <div className="flex flex-col items-center justify-center p-12 text-center bg-white border border-gray-200 rounded-xl shadow-sm">
      <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 mb-3">
        {icon}
      </div>
      <h4 className="text-sm font-semibold text-gray-900 mb-1">{title || defaultTitle}</h4>
      <p className="text-xs text-gray-500 max-w-sm leading-relaxed">{message || defaultMessage}</p>
    </div>
  );
};

