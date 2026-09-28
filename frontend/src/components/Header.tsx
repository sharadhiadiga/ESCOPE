import React from 'react';
import { Mail, User as UserIcon, LogOut, Layers, ExternalLink } from 'lucide-react';
import { UserProfile } from '../types/auth';

interface HeaderProps {
  user: UserProfile;
  onLogout: () => void;
  apiUrl?: string;
}

export const Header: React.FC<HeaderProps> = ({ user, onLogout, apiUrl = 'http://localhost:5000' }) => {
  const adminQueuesUrl = `${apiUrl.replace(/\/$/, '')}/admin/queues`;

  return (
    <header className="border-b border-gray-200 bg-white px-6 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="bg-emerald-600 p-2 rounded-lg text-white shadow-sm">
          <Mail className="w-4 h-4" />
        </div>
        <div>
          <h1 className="text-base font-bold text-gray-900 tracking-tight leading-none">ReachInbox</h1>
          <p className="text-[11px] text-gray-500 font-medium">Outbox Email Scheduler</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Link to BullMQ Queue Dashboard */}
        <a
          href={adminQueuesUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-medium transition flex items-center gap-1.5"
          title={`Open BullMQ Queue Dashboard on ${adminQueuesUrl}`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>BullMQ Dashboard</span>
          <ExternalLink className="w-3 h-3 text-emerald-600" />
        </a>

        {/* User Profile Pill */}
        <div className="flex items-center gap-2.5 bg-gray-50 border border-gray-200 rounded-full py-1 px-3">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name || 'User'}
              className="w-6 h-6 rounded-full object-cover border border-emerald-500/30"
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
              {user.name ? user.name[0].toUpperCase() : <UserIcon className="w-3 h-3" />}
            </div>
          )}
          <div className="text-left hidden sm:block">
            <p className="text-xs font-semibold text-gray-800 leading-tight">{user.name || 'User'}</p>
            <p className="text-[10px] text-gray-500 leading-tight">{user.email}</p>
          </div>
        </div>

        {/* Logout Button */}
        <button
          onClick={onLogout}
          className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200 text-xs font-medium transition flex items-center gap-1.5"
        >
          <LogOut className="w-3.5 h-3.5 text-gray-500" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  );
};

