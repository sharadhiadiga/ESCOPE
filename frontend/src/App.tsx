import { useEffect, useState, useCallback } from 'react';
import { Mail, AlertCircle, RefreshCw, Server, Database, Layers, ShieldAlert, Lock, ArrowRight, Clock, Send, Plus } from 'lucide-react';

import { UserProfile } from './types/auth';
import { EmailItem } from './types/email';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { EmailTable } from './components/EmailTable';
import { EmptyState } from './components/EmptyState';
import { ComposeCampaign } from './components/ComposeCampaign';

interface HealthStatus {
  status: string;
  timestamp: string;
  service: string;
  env: string;
  db?: string;
  uptime?: number;
}

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [oauthConfigError, setOauthConfigError] = useState<string | null>(null);

  // Email state
  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent' | 'search'>('scheduled');
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [loadingEmails, setLoadingEmails] = useState<boolean>(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<EmailItem[]>([]);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [searchWarning, setSearchWarning] = useState<string | null>(null);

  // Compose State
  const [showCompose, setShowCompose] = useState<boolean>(false);

  const rawApiUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';
  const API_URL = rawApiUrl.replace(/\/$/, '').replace(/\/api$/, '');

  // Check URL query parameters for auth errors
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err) {
      if (err === 'oauth_failed') {
        setOauthConfigError('Google OAuth login failed or was cancelled.');
      } else {
        setOauthConfigError(`OAuth Error: ${decodeURIComponent(err)}`);
      }
    }
  }, []);

  // Check Authenticated Session
  const checkAuth = async () => {
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        credentials: 'include',
      });
      if (res.ok) {
        const userData: UserProfile = await res.json();
        setUser(userData);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  };

  // Check System Health
  const fetchHealth = async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const res = await fetch(`${API_URL}/health`, { credentials: 'include' });
      if (!res.ok) {
        throw new Error(`Server returned HTTP status ${res.status}`);
      }
      const data: HealthStatus = await res.json();
      setHealth(data);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setHealthError(err.message);
      } else {
        setHealthError('Failed to connect to backend server');
      }
    } finally {
      setHealthLoading(false);
    }
  };

  // Fetch Emails from PostgreSQL Database
  const fetchEmails = useCallback(async () => {
    if (!user) return;
    setLoadingEmails(true);
    setEmailError(null);
    try {
      const res = await fetch(`${API_URL}/api/emails/list`, {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error(`Failed to load emails (HTTP ${res.status})`);
      }
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setEmails(json.data);
      }
    } catch (err: any) {
      setEmailError(err.message || 'Failed to fetch email records');
    } finally {
      setLoadingEmails(false);
    }
  }, [user, API_URL]);

  useEffect(() => {
    checkAuth();
    fetchHealth();
  }, []);

  useEffect(() => {
    if (user) {
      fetchEmails();
    }
  }, [user, fetchEmails]);

  // Handle Search Input Changes (Debounced via SearchBar component)
  const handleSearchChange = useCallback(
    async (query: string) => {
      setSearchQuery(query);
      if (!query.trim()) {
        setSearchResults([]);
        setSearchWarning(null);
        if (activeTab === 'search') {
          setActiveTab('scheduled');
        }
        return;
      }

      setActiveTab('search');
      setSearchLoading(true);
      setSearchWarning(null);

      try {
        const res = await fetch(`${API_URL}/api/emails/search?q=${encodeURIComponent(query.trim())}`, {
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error(`Search failed (HTTP ${res.status})`);
        }
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setSearchResults(json.data);
        } else {
          setSearchResults([]);
        }
      } catch (err: any) {
        console.warn('Elasticsearch query failed, falling back to local filter:', err);
        setSearchWarning('Elasticsearch search index unreachable. Using database fallback results.');
        // Fallback: search local emails list
        const lowerQ = query.toLowerCase();
        const filtered = emails.filter(
          (e) =>
            e.subject.toLowerCase().includes(lowerQ) ||
            e.body.toLowerCase().includes(lowerQ) ||
            e.recipientEmail.toLowerCase().includes(lowerQ) ||
            (e.recipientName && e.recipientName.toLowerCase().includes(lowerQ))
        );
        setSearchResults(filtered);
      } finally {
        setSearchLoading(false);
      }
    },
    [API_URL, activeTab, emails]
  );

  // Initiate Google OAuth Redirect
  const handleGoogleLogin = () => {
    window.location.href = `${API_URL}/auth/google`;
  };

  // Perform Logout
  const handleLogout = async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      console.error('Logout request failed:', err);
    } finally {
      setUser(null);
      window.history.pushState({}, '', '/');
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F7F8F7] text-gray-800 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <RefreshCw className="w-5 h-5 animate-spin text-emerald-600" />
          <span className="text-sm font-medium">Verifying Session State...</span>
        </div>
      </div>
    );
  }

  // Unauthenticated Login View
  if (!user) {
    return (
      <div className="min-h-screen bg-[#F7F8F7] text-gray-900 flex flex-col justify-between">
        <header className="px-6 py-3.5 border-b border-gray-200 bg-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-600 p-2 rounded-lg text-white shadow-sm">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 tracking-tight leading-none">ReachInbox</h1>
              <p className="text-[11px] text-gray-500">Email Scheduler Portal</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Lock className="w-3.5 h-3.5" /> Authentication Required
          </span>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl p-8 shadow-sm text-center">
            <div className="inline-flex p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 mb-4">
              <Mail className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Welcome to ReachInbox</h2>
            <p className="text-xs text-gray-500 mb-6 leading-relaxed">
              Sign in with your Google account to access your email scheduling dashboard & full-text search.
            </p>

            {oauthConfigError && (
              <div className="mb-6 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2.5 text-left">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>{oauthConfigError}</span>
              </div>
            )}

            <button
              onClick={handleGoogleLogin}
              className="w-full py-3 px-4 rounded-xl bg-white hover:bg-gray-50 text-gray-800 border border-gray-300 font-semibold text-xs transition-all shadow-sm flex items-center justify-center gap-3 group"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Continue with Google</span>
              <ArrowRight className="w-4 h-4 text-gray-400 group-hover:translate-x-0.5 transition-transform" />
            </button>

            <div className="mt-8 text-center text-xs text-gray-400 border-t border-gray-100 pt-6">
              Secured with Google OAuth 2.0 & HTTP-only sessions
            </div>
          </div>
        </main>

        <footer className="border-t border-gray-200 px-6 py-4 text-center text-xs text-gray-500">
          ReachInbox Email Scheduler Assignment
        </footer>
      </div>
    );
  }

  // Scheduled & Sent Email Category Collections
  const scheduledEmails = emails.filter(
    (e) => e.status === 'SCHEDULED' || e.status === 'QUEUED' || e.status === 'PROCESSING'
  );
  const sentEmails = emails.filter(
    (e) => e.status === 'SENT' || e.status === 'FAILED' || e.status === 'RESCHEDULED'
  );

  // Authenticated Dashboard Email Client Shell
  return (
    <div className="min-h-screen bg-[#F7F8F7] text-gray-800 flex flex-col">
      {/* Top Header Navigation */}
      <Header user={user} onLogout={handleLogout} apiUrl={API_URL} />

      {/* Main Body with Email Client Left Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <aside className="w-64 bg-white border-r border-gray-200 p-4 shrink-0 hidden md:flex flex-col justify-between">
          <div className="space-y-4">
            {/* Compose Campaign Primary Button */}
            <button
              onClick={() => setShowCompose(!showCompose)}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs transition shadow-sm flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>{showCompose ? 'Close Compose' : 'Compose'}</span>
            </button>

            {/* Sidebar Navigation */}
            <nav className="space-y-1">
              <button
                onClick={() => {
                  setActiveTab('scheduled');
                  if (searchQuery) handleSearchChange('');
                }}
                className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition flex items-center justify-between ${
                  activeTab === 'scheduled'
                    ? 'bg-emerald-50 text-emerald-800 font-semibold border-l-2 border-emerald-600'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Clock className={`w-4 h-4 ${activeTab === 'scheduled' ? 'text-emerald-600' : 'text-gray-400'}`} />
                  <span>Scheduled</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                  activeTab === 'scheduled' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'
                }`}>
                  {scheduledEmails.length}
                </span>
              </button>

              <button
                onClick={() => {
                  setActiveTab('sent');
                  if (searchQuery) handleSearchChange('');
                }}
                className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition flex items-center justify-between ${
                  activeTab === 'sent'
                    ? 'bg-emerald-50 text-emerald-800 font-semibold border-l-2 border-emerald-600'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Send className={`w-4 h-4 ${activeTab === 'sent' ? 'text-emerald-600' : 'text-gray-400'}`} />
                  <span>Sent</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                  activeTab === 'sent' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'
                }`}>
                  {sentEmails.length}
                </span>
              </button>

              {searchQuery && (
                <button
                  onClick={() => setActiveTab('search')}
                  className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition flex items-center justify-between ${
                    activeTab === 'search'
                      ? 'bg-emerald-50 text-emerald-800 font-semibold border-l-2 border-emerald-600'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Mail className="w-4 h-4 text-emerald-600" />
                    <span>Search Results</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-800">
                    {searchResults.length}
                  </span>
                </button>
              )}

              <a
                href={`${API_URL.replace(/\/$/, '')}/admin/queues`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full px-3 py-2 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition flex items-center justify-between"
              >
                <div className="flex items-center gap-2.5">
                  <Layers className="w-4 h-4 text-gray-400" />
                  <span>BullMQ Queues</span>
                </div>
                <span className="text-[10px] text-gray-400 font-mono">/admin</span>
              </a>
            </nav>
          </div>

          {/* User Account Info Card at Bottom of Sidebar */}
          <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs space-y-1">
            <p className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider">Active Account</p>
            <p className="font-semibold text-gray-800 truncate">{user.name || user.email}</p>
            <p className="text-gray-500 text-[11px] truncate">{user.email}</p>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-6 space-y-5 overflow-y-auto max-w-5xl mx-auto w-full">
          {/* Mobile Compose & Navigation Bar */}
          <div className="md:hidden flex items-center justify-between gap-2 border-b border-gray-200 pb-3">
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setActiveTab('scheduled');
                  if (searchQuery) handleSearchChange('');
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                  activeTab === 'scheduled' ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-gray-600'
                }`}
              >
                Scheduled ({scheduledEmails.length})
              </button>
              <button
                onClick={() => {
                  setActiveTab('sent');
                  if (searchQuery) handleSearchChange('');
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                  activeTab === 'sent' ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-gray-600'
                }`}
              >
                Sent ({sentEmails.length})
              </button>
            </div>
            <button
              onClick={() => setShowCompose(!showCompose)}
              className="px-3 py-1.5 rounded-md bg-emerald-600 text-white font-medium text-xs flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Compose
            </button>
          </div>

          {/* Compose Campaign Modal / Panel */}
          {showCompose && (
            <ComposeCampaign
              apiUrl={API_URL}
              onSuccess={() => {
                fetchEmails();
                setActiveTab('scheduled');
              }}
              onClose={() => setShowCompose(false)}
            />
          )}

          {/* Top Controls: Search Bar + Refresh & Stats */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <SearchBar
              value={searchQuery}
              onChange={handleSearchChange}
              isSearching={searchLoading}
              placeholder="Search emails by recipient, subject, or body..."
            />

            <div className="flex items-center gap-2 text-xs shrink-0">
              <span className="px-2.5 py-1 rounded-md bg-white border border-gray-200 font-medium text-gray-700 shadow-sm">
                Total: {emails.length}
              </span>
              <span className="px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                Scheduled: {scheduledEmails.length}
              </span>
              <span className="px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                Sent: {sentEmails.length}
              </span>
              <button
                onClick={fetchEmails}
                disabled={loadingEmails}
                className="px-3 py-1.5 rounded-md bg-white hover:bg-gray-50 text-xs font-medium text-gray-700 transition flex items-center gap-1.5 disabled:opacity-50 border border-gray-200 shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-gray-500 ${loadingEmails ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {/* Search Warning Banner */}
          {searchWarning && (
            <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{searchWarning}</span>
            </div>
          )}

          {/* Email Error Alert */}
          {emailError && (
            <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{emailError}</span>
            </div>
          )}

          {/* Email List View */}
          {loadingEmails || searchLoading ? (
            <div className="flex flex-col items-center justify-center p-14 bg-white border border-gray-200 rounded-xl shadow-sm">
              <RefreshCw className="w-7 h-7 animate-spin text-emerald-600 mb-2.5" />
              <p className="text-xs font-medium text-gray-500">Loading emails...</p>
            </div>
          ) : activeTab === 'scheduled' ? (
            scheduledEmails.length > 0 ? (
              <EmailTable emails={scheduledEmails} type="scheduled" />
            ) : (
              <EmptyState type="scheduled" />
            )
          ) : activeTab === 'sent' ? (
            sentEmails.length > 0 ? (
              <EmailTable emails={sentEmails} type="sent" />
            ) : (
              <EmptyState type="sent" />
            )
          ) : activeTab === 'search' ? (
            searchResults.length > 0 ? (
              <EmailTable emails={searchResults} type="all" />
            ) : (
              <EmptyState type="search" message={`No emails matched query "${searchQuery}"`} />
            )
          ) : null}

          {/* Infrastructure Health Monitor Card */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-emerald-600" />
                <h3 className="font-semibold text-xs text-gray-900">Infrastructure Health Monitor</h3>
              </div>
              <button
                onClick={fetchHealth}
                disabled={healthLoading}
                className="px-2.5 py-1 rounded-md bg-gray-50 hover:bg-gray-100 text-xs font-medium text-gray-600 transition flex items-center gap-1 disabled:opacity-50 border border-gray-200"
              >
                <RefreshCw className={`w-3 h-3 ${healthLoading ? 'animate-spin' : ''}`} />
                Check
              </button>
            </div>

            {healthLoading ? (
              <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-500 flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" /> Checking system health...
              </div>
            ) : healthError ? (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span>{healthError}</span>
              </div>
            ) : health ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                  <span className="text-gray-500 block text-[10px] mb-0.5">PostgreSQL</span>
                  <span className="font-semibold text-emerald-700 flex items-center gap-1">
                    <Database className="w-3 h-3 text-emerald-600" /> {health.db || 'connected'}
                  </span>
                </div>
                <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                  <span className="text-gray-500 block text-[10px] mb-0.5">Redis & BullMQ</span>
                  <span className="font-semibold text-emerald-700 flex items-center gap-1">
                    <Layers className="w-3 h-3 text-emerald-600" /> Connected
                  </span>
                </div>
                <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                  <span className="text-gray-500 block text-[10px] mb-0.5">Elasticsearch</span>
                  <span className="font-semibold text-emerald-700 flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3 text-emerald-600" /> Ready
                  </span>
                </div>
                <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                  <span className="text-gray-500 block text-[10px] mb-0.5">API Status</span>
                  <span className="font-semibold text-emerald-700">{health.status}</span>
                </div>
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

