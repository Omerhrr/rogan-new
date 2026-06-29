'use client';

import { Bell, Search, Radio, X, ArrowLeft, User, Settings, LogOut, BarChart3 } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { useState, useEffect, useRef, useCallback } from 'react';
import NotificationsPanel from '@/components/shared/NotificationsPanel';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

interface TopBarProps {
  onOpenProfile: () => void;
  onOpenSettings?: () => void;
  onOpenDashboard?: () => void;
  onOpenStream?: (streamId: string) => void;
  onOpenUserProfile?: (userId: string) => void;
}

interface SearchStream { id: string; title: string; creator?: { username: string } | null; viewer_count: number; category: string | null }
interface SearchUser { id: string; username: string; display_name: string | null; role: string; is_live: boolean }

export default function TopBar({ onOpenProfile, onOpenSettings, onOpenDashboard, onOpenStream, onOpenUserProfile }: TopBarProps) {
  const { user, logout } = useAuthStore();
  const { unreadCount } = useNotificationStore();
  const isMobile = useIsMobile(960);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const avatarMenuRef = useRef<HTMLDivElement>(null);
  const [streamResults, setStreamResults] = useState<SearchStream[]>([]);
  const [userResults, setUserResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setStreamResults([]);
      setUserResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const [streamsRes, usersRes] = await Promise.all([
          api.get('/streams/live', { params: { limit: 5 } }),
          api.get('/auth/users/search', { params: { q: searchQuery, limit: 5 } }),
        ]);
        const streams: SearchStream[] = (streamsRes.data.streams || []).filter((s: SearchStream) =>
          s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.creator?.username || '').toLowerCase().includes(searchQuery.toLowerCase())
        );
        setStreamResults(streams.slice(0, 4));
        setUserResults((usersRes.data.users || []).slice(0, 4));
      } catch {
        setStreamResults([]);
        setUserResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Close search dropdown on outside click
  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [searchOpen]);

  // Close avatar menu on outside click
  useEffect(() => {
    if (!avatarMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(e.target as Node)) {
        setAvatarMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [avatarMenuOpen]);

  const clearSearch = () => {
    setSearchQuery('');
    setStreamResults([]);
    setUserResults([]);
    setSearchOpen(false);
  };

  const closeMobileSearch = () => {
    setMobileSearchOpen(false);
    clearSearch();
  };

  const hasResults = streamResults.length > 0 || userResults.length > 0;

  // Focus mobile search input when overlay opens
  useEffect(() => {
    if (mobileSearchOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [mobileSearchOpen]);

  return (
    <>
      {/* ── Mobile full-screen search overlay ── */}
      {isMobile && mobileSearchOpen && (
        <div className="fixed inset-0 z-50 bg-surface-dark flex flex-col">
          {/* Header */}
          <div className="h-14 flex items-center gap-3 px-4 border-b border-white/5 bg-surface">
            <button onClick={closeMobileSearch} className="text-white/60 hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search streams, creators..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 transition-colors"
              />
            </div>
            {searchQuery && (
              <button onClick={clearSearch} className="text-white/30 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {/* Results */}
          <div className="flex-1 overflow-y-auto">
            {searching ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-rogan-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : !searchQuery ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Search className="w-8 h-8 text-white/20" />
                <p className="text-white/30 text-sm">Search streams and creators</p>
              </div>
            ) : !hasResults ? (
              <p className="text-white/30 text-sm text-center py-12">No results for &quot;{searchQuery}&quot;</p>
            ) : (
              <div className="pb-6">
                {streamResults.length > 0 && (
                  <div>
                    <p className="text-white/30 text-[10px] font-semibold uppercase tracking-wider px-4 pt-4 pb-2">Live Streams</p>
                    {streamResults.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => { onOpenStream?.(s.id); closeMobileSearch(); }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 active:bg-white/10 transition-colors text-left"
                      >
                        <div className="w-9 h-9 rounded-lg bg-rogan-600/20 flex items-center justify-center flex-shrink-0">
                          <Radio className="w-4 h-4 text-rogan-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm truncate">{s.title}</p>
                          <p className="text-white/40 text-xs">@{s.creator?.username} · {s.viewer_count} watching</p>
                        </div>
                        <span className="bg-rogan-600/20 text-rogan-400 text-[10px] px-1.5 py-0.5 rounded">LIVE</span>
                      </button>
                    ))}
                  </div>
                )}
                {userResults.length > 0 && (
                  <div>
                    <p className="text-white/30 text-[10px] font-semibold uppercase tracking-wider px-4 pt-4 pb-2">Users</p>
                    {userResults.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => { onOpenUserProfile?.(u.id); closeMobileSearch(); }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 active:bg-white/10 transition-colors text-left"
                      >
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                          {(u.username || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm truncate">{u.display_name || u.username}</p>
                          <p className="text-white/40 text-xs">@{u.username}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          {u.role === 'creator' && <span className="text-amber-400 text-[10px] bg-amber-600/10 px-1.5 py-0.5 rounded">Creator</span>}
                          {u.is_live && <span className="text-rogan-400 text-[10px] bg-rogan-600/10 px-1.5 py-0.5 rounded">LIVE</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

    <header className="h-14 bg-surface border-b border-white/5 flex items-center justify-between px-4 sticky top-0 z-40">
      {/* Left: Logo (mobile) */}
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
        <div className="flex-1 max-w-md mx-auto relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search streams, creators..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-8 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 focus:ring-1 focus:ring-rogan-500/25 transition-colors"
            />
            {searchQuery && (
              <button onClick={clearSearch} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Dropdown */}
          {searchOpen && searchQuery && (
            <div
              ref={dropdownRef}
              className="absolute top-full mt-2 w-full bg-surface border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50"
            >
              {searching ? (
                <div className="flex items-center justify-center py-6">
                  <div className="w-5 h-5 border-2 border-rogan-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : !hasResults ? (
                <p className="text-white/30 text-sm text-center py-6">No results for &quot;{searchQuery}&quot;</p>
              ) : (
                <div>
                  {streamResults.length > 0 && (
                    <div>
                      <p className="text-white/30 text-[10px] font-semibold uppercase tracking-wider px-4 pt-3 pb-1">Live Streams</p>
                      {streamResults.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => { onOpenStream?.(s.id); clearSearch(); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
                        >
                          <div className="w-7 h-7 rounded-lg bg-rogan-600/20 flex items-center justify-center flex-shrink-0">
                            <Radio className="w-3.5 h-3.5 text-rogan-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm truncate">{s.title}</p>
                            <p className="text-white/40 text-xs">@{s.creator?.username} · {s.viewer_count} watching</p>
                          </div>
                          <span className="bg-rogan-600/20 text-rogan-400 text-[10px] px-1.5 py-0.5 rounded">LIVE</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {userResults.length > 0 && (
                    <div>
                      <p className="text-white/30 text-[10px] font-semibold uppercase tracking-wider px-4 pt-3 pb-1">Users</p>
                      {userResults.map((u) => (
                        <button
                          key={u.id}
                          onClick={() => { onOpenUserProfile?.(u.id); clearSearch(); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
                        >
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                            {(u.username || 'U').charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm truncate">{u.display_name || u.username}</p>
                            <p className="text-white/40 text-xs">@{u.username}</p>
                          </div>
                          {u.role === 'creator' && <span className="text-amber-400 text-[10px] bg-amber-600/10 px-1.5 py-0.5 rounded">Creator</span>}
                          {u.is_live && <span className="text-rogan-400 text-[10px] bg-rogan-600/10 px-1.5 py-0.5 rounded">LIVE</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="h-2" />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Right: Search (mobile) + Bell + Avatar */}
      <div className="flex items-center gap-3">
        {isMobile && (
          <button
            onClick={() => setMobileSearchOpen(true)}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors"
            title="Search"
          >
            <Search className="w-5 h-5 text-white/60" />
          </button>
        )}
        <button
          onClick={() => setNotifOpen(true)}
          className="relative p-2 rounded-lg hover:bg-white/5 transition-colors"
          title="Notifications"
        >
          <Bell className="w-5 h-5 text-white/60" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-rogan-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        {/* Avatar + dropdown menu */}
        <div className="relative" ref={avatarMenuRef}>
          <button
            onClick={() => setAvatarMenuOpen((v) => !v)}
            className="w-8 h-8 rounded-full overflow-hidden border-2 border-rogan-500/50 hover:border-rogan-500 transition-colors"
            title="Account menu"
          >
            {user?.avatar ? (
              <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-xs font-bold">
                {(user?.username || 'U').charAt(0).toUpperCase()}
              </div>
            )}
          </button>

          {avatarMenuOpen && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-surface border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
              {/* User info header */}
              <div className="px-4 py-3 border-b border-white/5">
                <p className="text-white text-sm font-semibold truncate">{user?.username}</p>
                <p className="text-white/40 text-xs truncate">{user?.email}</p>
              </div>
              {(user?.role === 'creator' || user?.role === 'admin') && (
                <button
                  onClick={() => { setAvatarMenuOpen(false); onOpenDashboard?.(); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
                >
                  <BarChart3 className="w-4 h-4 text-white/50" />
                  <span className="text-white/80 text-sm">Dashboard</span>
                </button>
              )}
              <button
                onClick={() => { setAvatarMenuOpen(false); onOpenProfile(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
              >
                <User className="w-4 h-4 text-white/50" />
                <span className="text-white/80 text-sm">Profile</span>
              </button>
              <button
                onClick={() => { setAvatarMenuOpen(false); onOpenSettings?.(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
              >
                <Settings className="w-4 h-4 text-white/50" />
                <span className="text-white/80 text-sm">Settings</span>
              </button>
              <div className="border-t border-white/5" />
              <button
                onClick={() => { setAvatarMenuOpen(false); logout(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-red-900/20 transition-colors text-left"
              >
                <LogOut className="w-4 h-4 text-red-400/70" />
                <span className="text-red-400 text-sm">Log out</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <NotificationsPanel open={notifOpen} onClose={() => setNotifOpen(false)} />
    </header>
    </>
  );
}
