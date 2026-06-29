'use client';

/**
 * Rogan Live — Notifications Slide-Out Panel
 * Opens when the bell icon in TopBar is clicked.
 */

import { useEffect, useRef } from 'react';
import { Bell, X, Check, CheckCheck, Gift, MessageSquare, Radio, Star, Wallet, Swords } from 'lucide-react';
import { useNotificationStore } from '@/stores/notificationStore';
import { cn, timeAgo } from '@/lib/utils';
import type { Notification } from '@/types';

interface NotificationsPanelProps {
  open: boolean;
  onClose: () => void;
}

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  gift_received:      Gift,
  dm_received:        MessageSquare,
  stream_live:        Radio,
  task_completed:     Star,
  withdrawal_status:  Wallet,
  subscription:       Star,
  pk_challenge:       Swords,
  pk_battle:          Swords,
  marketplace_purchase: Gift,
  default:            Bell,
};

const TYPE_COLOR: Record<string, string> = {
  gift_received:      'bg-rogan-600/20 text-rogan-400',
  dm_received:        'bg-blue-600/20 text-blue-400',
  stream_live:        'bg-green-600/20 text-green-400',
  subscription:       'bg-pink-600/20 text-pink-400',
  pk_challenge:       'bg-amber-600/20 text-amber-400',
  pk_battle:          'bg-amber-600/20 text-amber-400',
  withdrawal_status:  'bg-purple-600/20 text-purple-400',
  marketplace_purchase: 'bg-teal-600/20 text-teal-400',
  default:            'bg-white/10 text-white/60',
};

function NotifIcon({ type }: { type: string }) {
  const Icon = TYPE_ICON[type] ?? TYPE_ICON.default;
  const color = TYPE_COLOR[type] ?? TYPE_COLOR.default;
  return (
    <div className={cn('w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0', color)}>
      <Icon className="w-4 h-4" />
    </div>
  );
}

export default function NotificationsPanel({ open, onClose }: NotificationsPanelProps) {
  const { notifications, isLoading, fetchNotifications, markAsRead, markAllAsRead } = useNotificationStore();
  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch when opened
  useEffect(() => {
    if (open) fetchNotifications();
  }, [open, fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const unread = notifications.filter((n) => !n.is_read);

  return (
    <>
      {/* Backdrop */}
      {open && <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />}

      {/* Panel */}
      <div
        ref={panelRef}
        className={cn(
          'fixed top-0 right-0 h-full w-full max-w-sm bg-surface border-l border-white/10 z-50 flex flex-col shadow-2xl transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-rogan-400" />
            <h2 className="text-white font-semibold">Notifications</h2>
            {unread.length > 0 && (
              <span className="bg-rogan-600 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                {unread.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unread.length > 0 && (
              <button
                onClick={markAllAsRead}
                className="flex items-center gap-1 text-white/40 hover:text-white text-xs transition-colors"
                title="Mark all as read"
              >
                <CheckCheck className="w-4 h-4" /> All read
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-white/40 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-rogan-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <Bell className="w-10 h-10 text-white/10" />
              <p className="text-white/30 text-sm">No notifications yet</p>
            </div>
          ) : (
            <div>
              {notifications.map((notif) => (
                <NotifRow
                  key={notif.id}
                  notif={notif}
                  onRead={() => !notif.is_read && markAsRead(notif.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function NotifRow({ notif, onRead }: { notif: Notification; onRead: () => void }) {
  return (
    <button
      onClick={onRead}
      className={cn(
        'w-full flex items-start gap-3 p-4 border-b border-white/5 text-left transition-colors hover:bg-white/5',
        !notif.is_read && 'bg-rogan-600/5'
      )}
    >
      <NotifIcon type={notif.type} />
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-medium truncate', notif.is_read ? 'text-white/60' : 'text-white')}>
          {notif.title}
        </p>
        <p className="text-white/40 text-xs mt-0.5 line-clamp-2">{notif.message}</p>
        <p className="text-white/25 text-xs mt-1">{notif.created_at ? timeAgo(notif.created_at) : ''}</p>
      </div>
      {!notif.is_read && (
        <div className="w-2 h-2 rounded-full bg-rogan-500 flex-shrink-0 mt-1.5" />
      )}
    </button>
  );
}
