'use client';

import { Radio, Swords, Store, MessageSquare, Wallet, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNotificationStore } from '@/stores/notificationStore';
import type { ViewType } from '@/types';

interface BottomNavProps {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
}

const TABS: { view: ViewType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { view: 'feed', label: 'Live', icon: Radio },
  { view: 'pk', label: 'PK', icon: Swords },
  { view: 'marketplace', label: 'Services', icon: Store },
  { view: 'messages', label: 'DMs', icon: MessageSquare },
  { view: 'wallet', label: 'Wallet', icon: Wallet },
  { view: 'profile', label: 'Me', icon: User },
];

export default function BottomNav({ activeView, onViewChange }: BottomNavProps) {
  const { unreadCount } = useNotificationStore();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-surface border-t border-white/10 safe-bottom z-50">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeView === tab.view;
          return (
            <button
              key={tab.view}
              onClick={() => onViewChange(tab.view)}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors relative',
                isActive ? 'text-rogan-500' : 'text-white/50'
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{tab.label}</span>
              {tab.view === 'messages' && unreadCount > 0 && (
                <span className="absolute top-1 right-1/4 bg-rogan-600 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
