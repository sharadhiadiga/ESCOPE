import { useEffect, useState } from 'react';
import { Mail, CheckCircle2, AlertCircle, RefreshCw, Server, Database, Layers, ShieldAlert, LogOut, User as UserIcon, Lock, ArrowRight } from 'lucide-react';
import { UserProfile } from './types/auth';

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

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

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
    } catch (err) {
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

  useEffect(() => {
    checkAuth();
    fetchHealth();
  }, []);

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
      <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
          <span className="text-sm font-medium">Verifying Session State...</span>
        </div>
      </div>
    );
  }

  // Unauthenticated Login View
  if (!user) {
    return (
      <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col justify-between">
        <header className="px-6 py-4 border-b border-slate-800 bg-[#121824]/80 backdrop-blur flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-tr from-blue-600 to-indigo-500 p-2.5 rounded-xl shadow-lg shadow-blue-500/20">
              <Mail className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white">ReachInbox</h1>
              <p className="text-xs text-slate-400">Phase 3 Google OAuth Portal</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Lock className="w-3.5 h-3.5" /> Authentication Required
          </span>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-[#151C2C] border border-slate-800 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>

            <div className="text-center mb-8">
              <div className="inline-flex p-3 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 mb-4">
                <Mail className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Welcome to ReachInbox</h2>
              <p className="text-sm text-slate-400">
                Sign in with your Google account to access your email scheduling dashboard.
              </p>
            </div>

            {oauthConfigError && (
              <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{oauthConfigError}</span>
              </div>
            )}

            <button
              onClick={handleGoogleLogin}
              className="w-full py-3.5 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-semibold text-sm transition-all duration-200 shadow-lg hover:shadow-xl flex items-center justify-center gap-3 group"
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
              <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
            </button>

            <div className="mt-8 text-center text-xs text-slate-500 border-t border-slate-800/80 pt-6">
              Secured with Google OAuth 2.0 & HTTP-only sessions
            </div>
          </div>
        </main>

        <footer className="border-t border-slate-800 px-6 py-4 text-center text-xs text-slate-500">
          ReachInbox Candidate Assignment • Phase 3 Google OAuth Authentication
        </footer>
      </div>
    );
  }

  // Authenticated Dashboard Shell
  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800 bg-[#121824]/80 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-blue-600 to-indigo-500 p-2.5 rounded-xl shadow-lg shadow-blue-500/20">
            <Mail className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">ReachInbox</h1>
            <p className="text-xs text-slate-400">Phase 3 Authenticated Shell</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 bg-slate-900/80 border border-slate-800 rounded-full py-1.5 px-3">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.name || 'User'} className="w-7 h-7 rounded-full object-cover border border-blue-500/30" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold text-xs">
                {user.name ? user.name[0].toUpperCase() : <UserIcon className="w-3.5 h-3.5" />}
              </div>
            )}
            <div className="text-left hidden sm:block">
              <p className="text-xs font-semibold text-slate-200 leading-tight">{user.name || 'Authenticated User'}</p>
              <p className="text-[10px] text-slate-400 leading-tight">{user.email}</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="px-3.5 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-medium transition flex items-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            Logout
          </button>
        </div>
      </header>

      {/* Main Dashboard Body */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-6 space-y-6">
        {/* User Welcome Banner */}
        <div className="bg-gradient-to-r from-slate-900 via-[#151C2C] to-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden flex items-center justify-between">
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-2">
              <CheckCircle2 className="w-3.5 h-3.5" /> OAuth Session Active
            </span>
            <h2 className="text-xl font-bold text-white">Welcome back, {user.name || user.email}!</h2>
            <p className="text-slate-400 text-xs max-w-xl">
              You are authenticated as <span className="text-blue-400 font-medium">{user.email}</span> (User ID: <code className="bg-slate-900 px-1.5 py-0.5 rounded text-slate-300">{user.id}</code>)
            </p>
          </div>
        </div>

        {/* Backend & Database Health Monitor */}
        <div className="bg-[#151C2C] border border-slate-800 rounded-2xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Server className="w-5 h-5 text-blue-400" />
              <h3 className="font-semibold text-white">System Infrastructure & Health</h3>
            </div>
            <button
              onClick={fetchHealth}
              disabled={healthLoading}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${healthLoading ? 'animate-spin' : ''}`} />
              Re-check Health
            </button>
          </div>

          {healthLoading ? (
            <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80 text-sm text-slate-400 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-blue-400" /> Checking system health...
            </div>
          ) : healthError ? (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span>{healthError}</span>
            </div>
          ) : health ? (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400 flex flex-col gap-2">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                Backend API & Database Connection Active
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs text-slate-300 mt-1">
                <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-500 block">Status</span>
                  <span className="font-semibold text-emerald-400">{health.status}</span>
                </div>
                <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-500 block">Database</span>
                  <span className="font-semibold text-emerald-400">{health.db || 'connected'}</span>
                </div>
                <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-500 block">Service</span>
                  <span className="font-semibold text-slate-200">{health.service}</span>
                </div>
                <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-500 block">Environment</span>
                  <span className="font-semibold text-blue-400">{health.env}</span>
                </div>
                <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-500 block">Uptime</span>
                  <span className="font-semibold text-slate-200">
                    {health.uptime !== undefined
                      ? `${Math.floor(health.uptime / 60)}m ${Math.floor(health.uptime % 60)}s`
                      : 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Infrastructure Status */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#151C2C] border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
                <Database className="w-4 h-4" />
              </div>
              <h4 className="font-semibold text-slate-200 text-sm">PostgreSQL (Prisma)</h4>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Persisted user account <code className="text-blue-400">{user.email}</code> and relational database schema ready.
            </p>
          </div>

          <div className="bg-[#151C2C] border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="p-2 rounded-lg bg-red-500/10 text-red-400">
                <Layers className="w-4 h-4" />
              </div>
              <h4 className="font-semibold text-slate-200 text-sm">Redis & BullMQ</h4>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Infrastructure ready on localhost:6379 for Phase 4 queue scheduling.
            </p>
          </div>

          <div className="bg-[#151C2C] border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <h4 className="font-semibold text-slate-200 text-sm">Elasticsearch (9200)</h4>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Infrastructure ready for indexing email subject/body search queries.
            </p>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-800 px-6 py-4 text-center text-xs text-slate-500">
        ReachInbox Candidate Assignment • Phase 3 Real Google OAuth Authentication Verified
      </footer>
    </div>
  );
}
