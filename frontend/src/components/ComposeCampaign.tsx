import React, { useState, useEffect, useRef } from 'react';
import { Send, Upload, AlertCircle, CheckCircle2, Loader2, X, Users, Clock, ShieldAlert } from 'lucide-react';


interface SenderAccount {
  id: string;
  email: string;
  displayName?: string | null;
  provider?: string;
}

interface LeadItem {
  recipientEmail: string;
  recipientName?: string;
  isValid: boolean;
  error?: string;
}

interface ComposeCampaignProps {
  apiUrl: string;
  onSuccess: () => void;
  onClose?: () => void;
}

export const ComposeCampaign: React.FC<ComposeCampaignProps> = ({ apiUrl, onSuccess, onClose }) => {
  // Form State
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [senderAccountId, setSenderAccountId] = useState('');
  const [senderAccounts, setSenderAccounts] = useState<SenderAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  // Schedule & Delay Configuration
  const [startAt, setStartAt] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 2); // Default 2 minutes in future
    return now.toISOString().slice(0, 16);
  });
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(200);

  // Leads State
  const [leadsText, setLeadsText] = useState('');
  const [parsedLeads, setParsedLeads] = useState<LeadItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Status State
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Load User's Available Sender Accounts
  useEffect(() => {
    const fetchAccounts = async () => {
      setLoadingAccounts(true);
      try {
        const res = await fetch(`${apiUrl}/api/email-accounts`, { credentials: 'include' });
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data)) {
            setSenderAccounts(json.data);
            if (json.data.length > 0) {
              setSenderAccountId(json.data[0].id);
            }
          }
        }
      } catch (err) {
        console.warn('Failed to load sender accounts:', err);
      } finally {
        setLoadingAccounts(false);
      }
    };

    fetchAccounts();
  }, [apiUrl]);

  // Parse Leads Text whenever leadsText changes
  useEffect(() => {
    if (!leadsText.trim()) {
      setParsedLeads([]);
      return;
    }

    const lines = leadsText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const leads: LeadItem[] = [];

    lines.forEach((line, index) => {
      // Check header line
      if (index === 0 && (line.toLowerCase().includes('email') || line.toLowerCase().includes('recipient'))) {
        return;
      }

      let email = '';
      let nameStr = '';

      if (line.includes(',')) {
        const parts = line.split(',').map((p) => p.trim());
        if (emailRegex.test(parts[0])) {
          email = parts[0];
          nameStr = parts[1] || '';
        } else if (emailRegex.test(parts[1])) {
          email = parts[1];
          nameStr = parts[0] || '';
        } else {
          email = parts[0];
        }
      } else if (line.includes('<') && line.includes('>')) {
        const match = line.match(/^(.*)<(.*)>$/);
        if (match) {
          nameStr = match[1].trim();
          email = match[2].trim();
        } else {
          email = line;
        }
      } else {
        email = line;
      }

      const isValid = emailRegex.test(email);
      leads.push({
        recipientEmail: email,
        recipientName: nameStr || undefined,
        isValid,
        error: isValid ? undefined : `Row ${index + 1}: Invalid email address "${line}"`,
      });
    });

    setParsedLeads(leads);
  }, [leadsText]);

  // Handle CSV File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setLeadsText(content);
      }
    };
    reader.readAsText(file);
  };

  const validLeads = parsedLeads.filter((l) => l.isValid);
  const invalidLeads = parsedLeads.filter((l) => !l.isValid);

  // Form Validation & Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);

    const errors: Record<string, string> = {};

    if (!name.trim()) errors.name = 'Campaign name is required';
    if (!subject.trim()) errors.subject = 'Email subject is required';
    if (!body.trim()) errors.body = 'Email body content is required';
    if (!senderAccountId) errors.senderAccountId = 'Sender account is required';
    if (validLeads.length === 0) errors.leads = 'At least 1 valid recipient lead is required';
    if (delaySeconds < 0) errors.delaySeconds = 'Delay must be 0 seconds or greater';
    if (hourlyLimit < 1) errors.hourlyLimit = 'Hourly limit must be at least 1';

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors({});
    setSubmitting(true);

    try {
      const payload = {
        name: name.trim(),
        senderAccountId,
        subject: subject.trim(),
        body: body.trim(),
        startAt: new Date(startAt).toISOString(),
        delayBetweenEmailsMs: delaySeconds * 1000,
        hourlyLimit,
        leads: validLeads.map((l) => ({
          recipientEmail: l.recipientEmail,
          recipientName: l.recipientName || null,
        })),
      };

      const res = await fetch(`${apiUrl}/api/emails/campaign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || 'Failed to schedule campaign');
      }

      setSubmitSuccess(
        `Campaign "${name}" scheduled successfully with ${validLeads.length} leads!`
      );

      // Reset Form Inputs
      setName('');
      setSubject('');
      setBody('');
      setLeadsText('');
      setParsedLeads([]);

      onSuccess();
    } catch (err: any) {
      setSubmitError(err.message || 'Error occurred while scheduling campaign');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-xl relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 border-b border-gray-200 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Send className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">Compose New Email</h3>
            <p className="text-xs text-gray-500">Configure email content, recipients, and schedule limits</p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Success Notification Banner */}
      {submitSuccess && (
        <div className="mb-5 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{submitSuccess}</span>
          </div>
          <button onClick={() => setSubmitSuccess(null)} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Error Notification Banner */}
      {submitError && (
        <div className="mb-5 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Campaign Name & Sender Account Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Campaign Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Product Update Campaign"
              className={`w-full px-3 py-2 bg-white border ${
                validationErrors.name ? 'border-rose-400' : 'border-gray-200'
              } rounded-lg text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition`}
            />
            {validationErrors.name && (
              <p className="mt-1 text-[11px] text-rose-600">{validationErrors.name}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              From Sender Account <span className="text-rose-500">*</span>
            </label>
            {loadingAccounts ? (
              <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-500 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" /> Loading sender accounts...
              </div>
            ) : (
              <select
                value={senderAccountId}
                onChange={(e) => setSenderAccountId(e.target.value)}
                className={`w-full px-3 py-2 bg-white border ${
                  validationErrors.senderAccountId ? 'border-rose-400' : 'border-gray-200'
                } rounded-lg text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition`}
              >
                {senderAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.displayName ? `${acc.displayName} (${acc.email})` : acc.email}
                  </option>
                ))}
              </select>
            )}
            {validationErrors.senderAccountId && (
              <p className="mt-1 text-[11px] text-rose-600">{validationErrors.senderAccountId}</p>
            )}
          </div>
        </div>

        {/* Email Subject */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Subject <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Enter email subject line..."
            className={`w-full px-3 py-2 bg-white border ${
              validationErrors.subject ? 'border-rose-400' : 'border-gray-200'
            } rounded-lg text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition`}
          />
          {validationErrors.subject && (
            <p className="mt-1 text-[11px] text-rose-600">{validationErrors.subject}</p>
          )}
        </div>

        {/* Email Body Content */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Email Body <span className="text-rose-500">*</span>
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="Write your email body message here..."
            className={`w-full px-3 py-2 bg-white border ${
              validationErrors.body ? 'border-rose-400' : 'border-gray-200'
            } rounded-lg text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition resize-y`}
          />
          {validationErrors.body && (
            <p className="mt-1 text-[11px] text-rose-600">{validationErrors.body}</p>
          )}
        </div>

        {/* Lead Import & CSV Upload Section */}
        <div className="bg-gray-50/80 border border-gray-200 rounded-lg p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-emerald-600" />
              Recipients / Leads <span className="text-rose-500">*</span>
            </label>

            <div className="flex items-center gap-2">
              <input
                type="file"
                ref={fileInputRef}
                accept=".csv,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-2.5 py-1 rounded-md bg-white hover:bg-gray-100 text-xs text-gray-700 font-medium transition flex items-center gap-1.5 border border-gray-200 shadow-sm"
              >
                <Upload className="w-3.5 h-3.5 text-emerald-600" />
                Upload CSV / Text
              </button>
            </div>
          </div>

          <textarea
            value={leadsText}
            onChange={(e) => setLeadsText(e.target.value)}
            rows={3}
            placeholder="Paste recipient email addresses (e.g. john@example.com, John Smith)"
            className={`w-full px-3 py-2 bg-white border ${
              validationErrors.leads ? 'border-rose-400' : 'border-gray-200'
            } rounded-md text-xs text-gray-800 placeholder-gray-400 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition resize-y`}
          />

          {/* Lead Validation Summary */}
          {parsedLeads.length > 0 && (
            <div className="flex flex-wrap items-center justify-between text-xs pt-1 border-t border-gray-200">
              <div className="flex items-center gap-3">
                <span className="text-emerald-700 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {validLeads.length} Valid Leads
                </span>
                {invalidLeads.length > 0 && (
                  <span className="text-amber-700 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> {invalidLeads.length} Invalid Rows
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Invalid Lead Warnings */}
          {invalidLeads.length > 0 && (
            <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-800 space-y-1">
              {invalidLeads.slice(0, 3).map((l, i) => (
                <p key={i}>{l.error}</p>
              ))}
              {invalidLeads.length > 3 && (
                <p className="font-semibold">+ {invalidLeads.length - 3} more invalid rows ignored</p>
              )}
            </div>
          )}

          {validationErrors.leads && (
            <p className="text-[11px] text-rose-600">{validationErrors.leads}</p>
          )}
        </div>

        {/* Schedule & Throttling Configuration Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-gray-50/80 border border-gray-200 rounded-lg p-3.5">
          {/* Start Date & Time */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-gray-500" /> Start Date & Time
            </label>
            <input
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-md text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
            />
          </div>

          {/* Delay Between Emails */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-gray-500" /> Inter-Email Delay (Sec)
            </label>
            <input
              type="number"
              min="0"
              max="3600"
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(parseInt(e.target.value, 10) || 0)}
              className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-md text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
            />
          </div>

          {/* Hourly Rate Limit */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-gray-500" /> Hourly Rate Limit
            </label>
            <input
              type="number"
              min="1"
              max="10000"
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(parseInt(e.target.value, 10) || 1)}
              className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-md text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
            />
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-gray-100">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-xs transition"
            >
              Cancel
            </button>
          )}

          <button
            type="submit"
            disabled={submitting || validLeads.length === 0}
            className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-all shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Scheduling Campaign...</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Send Later ({validLeads.length} Emails)</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

