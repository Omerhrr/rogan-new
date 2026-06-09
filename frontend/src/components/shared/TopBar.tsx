'use client';

import { Bell, Search } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { useState } from 'react';

interface TopBarProps {
  onOpenProfile: () => void;
}

export default function TopBar({ onOpenProfile }: TopBarProps) {
  const { user } = useAuthStore();
  const { unreadCount } = useNotificationStore();
  const isMobile = useIsMobile(960);
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <header className="h-14 bg-surface border-b border-white/5 flex items-center justify-between px-4 sticky top-0 z-40">
      {/* Left: Logo (mobile) or empty (desktop - sidebar has logo) */}
      <div className="flex items-center gap-3">
        {isMobile && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-rogan-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">R</span>
            </div>
            <span className="font-bold text-white">Rogan</span>
          </div>
        )}
      </div>

      {/* Center: Search */}
      {!isMobile && (
        <div className="flex-1 max-w-md mx-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="text"
              placeholder="Search streams, creators..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 focus:ring-1 focus:ring-rogan-500/25 transition-colors"
            />
          </div>
        </div>
      )}

      {/* Right: Notifications + Avatar */}
      <div className="flex items-center gap-3">
        <button className="relative p-2 rounded-lg hover:bg-white/5 transition-colors">
          <Bell className="w-5 h-5 text-white/60" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-rogan-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={onOpenProfile}
          className="w-8 h-8 rounded-full overflow-hidden border-2 border-rogan-500/50 hover:border-rogan-500 transition-colors"
        >
          {user?.avatar ? (
            <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-xs font-bold">
              {(user?.username || 'U').charAt(0).toUpperCase()}
            </div>
          )}
        </button>
      </div>
    </header>
  );
}
