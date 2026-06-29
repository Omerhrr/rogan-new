'use client';

/**
 * Rogan Live v3 — SPA Shell
 * Single-page app with client-side view routing.
 * Desktop: Sidebar + main content
 * Mobile: Bottom nav + full-screen content
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useIsMobile, useLayoutMode } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { UserWSClient } from '@/lib/userWs';
import { MessageSquare, X } from 'lucide-react';
import type { ViewType } from '@/types';

// Views
import AuthView from '@/components/auth/AuthView';
import Sidebar from '@/components/shared/Sidebar';
import BottomNav from '@/components/shared/BottomNav';
import TopBar from '@/components/shared/TopBar';

// Lazy-loaded views
import LiveFeed from '@/components/live/LiveFeed';
import LiveRoom from '@/components/live/LiveRoom';
import GoLive from '@/components/live/GoLive';
import WalletView from '@/components/wallet/WalletView';
import DMView from '@/components/dm/DMView';
import ProfileView from '@/components/profile/ProfileView';
import CreatorDashboard from '@/components/dashboard/CreatorDashboard';
import MarketplaceView from '@/components/marketplace/MarketplaceView';
import PKArena from '@/components/pk/PKArena';
import SubscriptionsView from '@/components/subscriptions/SubscriptionsView';
import AdminView from '@/components/admin/AdminView';
import PrivateShowsView from '@/components/live/PrivateShowsView';
import SettingsView from '@/components/settings/SettingsView';
import CreatorOnboardingModal from '@/components/creator/CreatorOnboardingModal';

interface DMToast {
  id: string;
  fromUsername: string;
  preview: string;
  conversationId: string;
}

interface StreamToast {
  id: string;
  streamId: string;
  creatorUsername: string;
  title: string;
}

export default function Home() {
  const { isAuthenticated, checkAuth, user } = useAuthStore();
  const { fetchUnreadCount, incrementUnread } = useNotificationStore();
  const isMobile = useIsMobile(960);
  const layoutMode = useLayoutMode();
  const [activeView, setActiveView] = useState<ViewType>('feed');
  const [viewingStreamId, setViewingStreamId] = useState<string | null>(null);
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [dmToasts, setDmToasts] = useState<DMToast[]>([]);
  const [streamToasts, setStreamToasts] = useState<StreamToast[]>([]);
  const userWsRef = useRef<UserWSClient | null>(null);

  // Check auth on mount
  useEffect(() => {
    checkAuth().finally(() => setInitialized(true));
  }, [checkAuth]);

  // Show creator onboarding when user becomes a creator for the first time
  useEffect(() => {
    if (!user || user.role !== 'creator') return;
    const seen = localStorage.getItem(`rogan_onboarding_done_${user.id}`);
    if (!seen) setShowOnboarding(true);
  }, [user?.id, user?.role]);

  // Fetch unread notifications periodically
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchUnreadCount]);

  // Global user-level WS — receives new DM toasts in real time
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('rogan_token') ?? '' : '';
    if (!token) return;

    const ws = new UserWSClient({
      userId: user.id,
      token,
      onNewDM: ({ from_username, preview, conversation_id }) => {
        if (activeView === 'messages') return;
        const toastId = `${Date.now()}-${Math.random()}`;
        setDmToasts((prev) => [...prev.slice(-2), { id: toastId, fromUsername: from_username, preview, conversationId: conversation_id }]);
        incrementUnread();
        setTimeout(() => setDmToasts((prev) => prev.filter((t) => t.id !== toastId)), 5000);
      },
      onStreamLive: ({ stream_id, creator_username, title }) => {
        const toastId = `sl-${Date.now()}-${Math.random()}`;
        setStreamToasts((prev) => [...prev.slice(-2), { id: toastId, streamId: stream_id, creatorUsername: creator_username, title }]);
        setTimeout(() => setStreamToasts((prev) => prev.filter((t) => t.id !== toastId)), 8000);
      },
    });
    ws.connect();
    userWsRef.current = ws;
    return () => { ws.disconnect(); userWsRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id]);

  const isCreatorRole = user?.role === 'creator' || user?.role === 'admin';

  const openStream = useCallback((streamId: string, creatorId?: string) => {
    // If the current user is the streamer, send them to GoLive instead of LiveRoom
    if (creatorId && user?.id && creatorId === user.id) {
      setActiveView('golive');
      return;
    }
    setViewingStreamId(streamId);
    setActiveView('feed');
  }, [user?.id]);

  const openProfile = useCallback((userId: string) => {
    setViewingUserId(userId);
    setActiveView('profile');
  }, []);

  // Show loading while checking auth
  if (!initialized) {
    return (
      <div className="min-h-screen bg-surface-dark flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-rogan-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-white/60 text-sm">Loading Rogan Live...</p>
        </div>
      </div>
    );
  }

  // Not authenticated → show auth view
  if (!isAuthenticated) {
    return <AuthView />;
  }

  // Render the active view content — GoLive is excluded here (rendered persistently below)
  const renderView = () => {
    // If viewing a specific stream, show LiveRoom
    if (viewingStreamId) {
      return (
        <LiveRoom
          streamId={viewingStreamId}
          onBack={() => setViewingStreamId(null)}
          onOpenProfile={(userId) => {
            setViewingStreamId(null);
            setViewingUserId(userId);
            setActiveView('profile');
          }}
        />
      );
    }

    switch (activeView) {
      case 'feed':
        return <LiveFeed onOpenStream={openStream} />;
      // 'golive' is rendered persistently outside this switch — see below
      case 'messages':
        return <DMView />;
      case 'wallet':
        return <WalletView />;
      case 'marketplace':
        return <MarketplaceView />;
      case 'profile':
        return (
          <ProfileView
            userId={viewingUserId || user?.id || null}
            onOpenStream={openStream}
            onOpenDM={(uid) => {
              setViewingUserId(uid);
              setActiveView('messages');
            }}
            onOpenProfile={(uid) => {
              setViewingUserId(uid);
              setActiveView('profile');
            }}
          />
        );
      case 'dashboard':
        return <CreatorDashboard />;
      case 'pk':
        return <PKArena />;
      case 'subscriptions':
        return <SubscriptionsView />;
      case 'moderation':
        return <AdminView />;
      case 'private-shows':
        return <PrivateShowsView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <LiveFeed onOpenStream={openStream} />;
    }
  };

  // GoLive is active when the user has explicitly navigated to 'golive' and is
  // not currently watching a stream in LiveRoom.
  const goLiveVisible = activeView === 'golive' && !viewingStreamId;

  return (
    <div className="min-h-screen bg-surface-dark flex">
      <CreatorOnboardingModal
        open={showOnboarding}
        onClose={() => setShowOnboarding(false)}
      />
      {/* Desktop Sidebar */}
      {!isMobile && (
        <Sidebar
          activeView={activeView}
          onViewChange={(view) => {
            setViewingStreamId(null);
            setActiveView(view);
          }}
        />
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-h-screen">
        {/* Top Bar */}
        <TopBar
          onOpenProfile={() => {
            setViewingUserId(null);
            setActiveView('profile');
          }}
          onOpenSettings={() => setActiveView('settings')}
          onOpenDashboard={() => setActiveView('dashboard')}
          onOpenStream={openStream}
          onOpenUserProfile={(uid) => {
            setViewingUserId(uid);
            setActiveView('profile');
          }}
        />

        {/* View Content */}
        <div className="flex-1 overflow-hidden relative">
    
          {/*
           * GoLive is rendered PERSISTENTLY (never unmounted) for creator/admin roles.
           * This keeps the camera stream and WebRTC peer connection alive even when
           * the user navigates to another tab. CSS hides it — no unmount/remount.
           */}
          {isCreatorRole && (
            <div className={cn('absolute inset-0 z-10', goLiveVisible ? 'flex flex-col' : 'hidden')}>
              <GoLive />
            </div>
          )}

          {/* All other views — animated, key-switched */}
          <AnimatePresence mode="wait">
            {!goLiveVisible && (
              <motion.div
                key={viewingStreamId || activeView}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                className="h-full"
              >
                {renderView()}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Mobile Bottom Nav — hidden during fullscreen stream so it doesn't cover the chat */}
        {isMobile && !viewingStreamId && (
          <BottomNav
            activeView={activeView}
            onViewChange={(view) => {
              setViewingStreamId(null);
              setActiveView(view);
            }}
          />
        )}
      </main>

      {/* Stream Live Toasts — appear top-right, auto-dismiss after 8s */}
      <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
        {streamToasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-3 bg-surface border border-red-500/30 rounded-xl px-4 py-3 shadow-2xl max-w-xs w-full animate-slide-in-right"
          >
            <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-sm">🔴</span>
            </div>
            <button
              className="flex-1 text-left min-w-0"
              onClick={() => {
                setStreamToasts((prev) => prev.filter((t) => t.id !== toast.id));
                openStream(toast.streamId);
              }}
            >
              <p className="text-red-400 text-xs font-semibold">
                {toast.creatorUsername} is live!
              </p>
              <p className="text-white/60 text-xs truncate mt-0.5">{toast.title}</p>
              <p className="text-blue-400 text-xs mt-1 font-medium">Tap to watch →</p>
            </button>
            <button
              onClick={() => setStreamToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* DM Toast Notifications — appear top-right, auto-dismiss after 5s */}
      <div className="fixed right-4 z-[199] flex flex-col gap-2 pointer-events-none" style={{ top: streamToasts.length > 0 ? `${4 + streamToasts.length * 5.5}rem` : '1rem' }}>
        {dmToasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-3 bg-surface border border-white/10 rounded-xl px-4 py-3 shadow-2xl max-w-xs w-full animate-slide-in-right"
          >
            <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <MessageSquare className="w-4 h-4 text-blue-400" />
            </div>
            <button
              className="flex-1 text-left min-w-0"
              onClick={() => {
                setDmToasts((prev) => prev.filter((t) => t.id !== toast.id));
                setViewingStreamId(null);
                setActiveView('messages');
              }}
            >
              <p className="text-white text-xs font-semibold truncate">{toast.fromUsername}</p>
              <p className="text-white/60 text-xs truncate mt-0.5">{toast.preview}</p>
            </button>
            <button
              onClick={() => setDmToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
                      >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
