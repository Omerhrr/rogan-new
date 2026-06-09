'use client';

import { 
  Radio, Video, Wallet, MessageSquare, Store, Crown, 
  LayoutDashboard, Shield, ChevronLeft, ChevronRight 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import type { ViewType } from '@/types';
import { useState } from 'react';

interface SidebarProps {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
}

const NAV_ITEMS: { view: ViewType; label: string; icon: React.ComponentType<{ className?: string }>; roles?: string[] }[] = [
  { view: 'feed', label: 'Live Feed', icon: Radio },
  { view: 'golive', label: 'Go Live', icon: Video, roles: ['creator', 'admin'] },
  { view: 'wallet', label: 'Wallet', icon: Wallet },
  { view: 'messages', label: 'Messages', icon: MessageSquare },
  { view: 'marketplace', label: 'Marketplace', icon: Store },
  { view: 'subscriptions', label: 'Subscriptions', icon: Crown },
  { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['creator', 'admin'] },
  { view: 'moderation', label: 'Moderation', icon: Shield, roles: ['admin'] },
];

export default function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const { user } = useAuthStore();
  const { unreadCount } = useNotificationStore();
  const [collapsed, setCollapsed] = useState(false);

  const filteredItems = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(user?.role || 'user')
  );

  return (
    <aside
      className={cn(
        'h-screen bg-surface border-r border-white/5 flex flex-col transition-all duration-300 sticky top-0',
        collapsed ? 'w-[72px]' : 'w-[264px]'
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-white/5">
        <div className="w-9 h-9 rounded-xl bg-rogan-600 flex items-center justify-center flex-shrink-0">
          <Radio className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <span className="text-lg font-bold text-white tracking-tight">Rogan Live</span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto scrollbar-thin">
        {filteredItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.view;
          return (
            <button
              key={item.view}
              onClick={() => onViewChange(item.view)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-rogan-600 text-white shadow-lg shadow-rogan-600/20'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              )}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
              {!collapsed && item.view === 'messages' && unreadCount > 0 && (
                <span className="ml-auto bg-rogan-600 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Collapse Toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center h-12 border-t border-white/5 text-white/40 hover:text-white transition-colors"
      >
        {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
      </button>
    </aside>
  );
}
