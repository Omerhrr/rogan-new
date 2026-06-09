'use client';

/**
 * Rogan Live v3 — SPA Shell
 * Single-page app with client-side view routing.
 * Desktop: Sidebar + main content
 * Mobile: Bottom nav + full-screen content
 */

import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useIsMobile, useLayoutMode } from '@/hooks/use-mobile';
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
import ModerationView from '@/components/moderation/ModerationView';

export default function Home() {
  const { isAuthenticated, checkAuth, user } = useAuthStore();
  const { fetchUnreadCount } = useNotificationStore();
  const isMobile = useIsMobile(960);
  const layoutMode = useLayoutMode();
  const [activeView, setActiveView] = useState<ViewType>('feed');
  const [viewingStreamId, setViewingStreamId] = useState<string | null>(null);
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Check auth on mount
  useEffect(() => {
    checkAuth().finally(() => setInitialized(true));
  }, [checkAuth]);

  // Fetch unread notifications periodically
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchUnreadCount]);

  const openStream = useCallback((streamId: string) => {
    setViewingStreamId(streamId);
    setActiveView('feed'); // Will show LiveRoom overlay
  }, []);

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

  // Render the active view content
  const renderView = () => {
    // If viewing a specific stream, show LiveRoom
    if (viewingStreamId) {
      return (
        <LiveRoom
          streamId={viewingStreamId}
          onBack={() => setViewingStreamId(null)}
        />
      );
    }

    switch (activeView) {
      case 'feed':
        return <LiveFeed onOpenStream={openStream} />;
      case 'golive':
        return <GoLive />;
      case 'messages':
        return <DMView />;
      case 'wallet':
        return <WalletView />;
      case 'marketplace':
        return <MarketplaceView />;
      case 'profile':
        return <ProfileView userId={viewingUserId || user?.id || null} />;
      case 'dashboard':
        return <CreatorDashboard />;
      case 'pk':
        return <PKArena />;
      case 'subscriptions':
        return <SubscriptionsView />;
      case 'moderation':
        return <ModerationView />;
      default:
        return <LiveFeed onOpenStream={openStream} />;
    }
  };

  return (
    <div className="min-h-screen bg-surface-dark flex">
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
        />

        {/* View Content */}
        <div className="flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
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
          </AnimatePresence>
        </div>

        {/* Mobile Bottom Nav */}
        {isMobile && (
          <BottomNav
            activeView={activeView}
            onViewChange={(view) => {
              setViewingStreamId(null);
              setActiveView(view);
            }}
          />
        )}
      </main>
    </div>
  );
}
