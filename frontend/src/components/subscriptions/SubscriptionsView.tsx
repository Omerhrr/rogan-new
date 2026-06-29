'use client';

import { useState, useEffect } from 'react';
import { Crown, Star, Zap, Plus, Check, X } from 'lucide-react';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn, formatTK } from '@/lib/utils';
import EmptyState from '@/components/shared/EmptyState';
import type { SubscriptionTier } from '@/types';

const TIER_ICONS = { basic: Star, premium: Zap, vip: Crown };
const TIER_COLORS = { basic: 'text-blue-400', premium: 'text-purple-400', vip: 'text-amber-400' };
const TIER_BG    = { basic: 'from-blue-600/20', premium: 'from-purple-600/20', vip: 'from-amber-600/20' };

function tierLevel(name: string): 'basic' | 'premium' | 'vip' {
  const n = name.toLowerCase();
  if (n.includes('vip')) return 'vip';
  if (n.includes('premium')) return 'premium';
  return 'basic';
}

function TierCard({ tier, onSubscribe, isLoading }: { tier: SubscriptionTier; onSubscribe: () => void; isLoading: boolean }) {
  const lvl = tierLevel(tier.name);
  const Icon = TIER_ICONS[lvl];
  const perks: string[] = tier.perks
    ? (typeof tier.perks === 'string' ? JSON.parse(tier.perks) : tier.perks)
    : [];

  return (
    <div className={cn('bg-gradient-to-br to-surface rounded-xl p-5 border border-white/5 flex flex-col', TIER_BG[lvl])}>
      <div className="flex items-center gap-2 mb-3">
        <Icon className={cn('w-5 h-5', TIER_COLORS[lvl])} />
        <h3 className="text-white font-semibold">{tier.name}</h3>
      </div>
      <p className="text-white text-2xl font-bold mb-1">
        {formatTK(tier.price_tk)}&nbsp;<span className="text-sm font-normal text-white/40">TK/mo</span>
      </p>
      {perks.length > 0 && (
        <ul className="space-y-1 mb-4 flex-1">
          {perks.map((perk, i) => (
            <li key={i} className="text-white/50 text-xs flex items-center gap-1.5">
              <Check className="w-3 h-3 text-green-400 flex-shrink-0" /> {perk}
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={onSubscribe}
        disabled={isLoading}
        className="mt-auto w-full py-2 bg-rogan-600 hover:bg-rogan-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
      >
        {isLoading ? 'Subscribing…' : 'Subscribe'}
      </button>
    </div>
  );
}

export default function SubscriptionsView() {
  const {
    tiers, mySubscriptions, mySubscribers,
    fetchTiers, fetchMySubscriptions, fetchMySubscribers,
    createTier, subscribe, cancelSubscription, isLoading,
  } = useSubscriptionStore();
  const { user } = useAuthStore();
  const isMobile = useIsMobile(960);
  const isCreator = user?.role === 'creator' || user?.role === 'admin';

  const [activeTab, setActiveTab] = useState<'tiers' | 'subscribed' | 'subscribers'>(
    isCreator ? 'tiers' : 'subscribed'
  );
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newPerks, setNewPerks] = useState('');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (user?.id && isCreator) fetchTiers(user.id);
    fetchMySubscriptions();
    if (isCreator) fetchMySubscribers();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isCreator]);

  const handleCreateTier = async () => {
    if (!newName.trim() || !newPrice) return;
    setErrMsg(null);
    try {
      await createTier({
        name: newName,
        price_tk: parseFloat(newPrice),
        perks: newPerks ? newPerks.split(',').map((p) => p.trim()).filter(Boolean) : undefined,
      });
      setShowCreate(false);
      setNewName(''); setNewPrice(''); setNewPerks('');
      if (user?.id) fetchTiers(user.id);
      setSuccessMsg('Tier created!');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e: any) {
      setErrMsg(e?.response?.data?.detail || 'Failed to create tier');
    }
  };

  const handleSubscribe = async (tier: SubscriptionTier) => {
    setErrMsg(null);
    try {
      await subscribe({ creator_id: tier.creator_id, tier_id: tier.id });
      fetchMySubscriptions();
      setSuccessMsg(`Subscribed to ${tier.name}!`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e: any) {
      setErrMsg(e?.response?.data?.detail || 'Subscription failed');
    }
  };

  const handleCancel = async (id: string) => {
    setErrMsg(null);
    try {
      await cancelSubscription(id);
    } catch (e: any) {
      setErrMsg(e?.response?.data?.detail || 'Failed to cancel');
    }
  };

  const tabs = isCreator
    ? (['tiers', 'subscribed', 'subscribers'] as const)
    : (['subscribed'] as const);

  const TAB_LABELS: Record<string, string> = {
    tiers: 'My Tiers',
    subscribed: 'Subscribed',
    subscribers: 'Subscribers',
  };

  return (
    <div className={cn('h-full overflow-y-auto scrollbar-thin', isMobile ? 'p-4 pb-24' : 'p-6')}>
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Crown className="w-5 h-5 text-rogan-500" /> Subscriptions
          </h2>
          {isCreator && (
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 bg-rogan-600 hover:bg-rogan-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" /> Create Tier
            </button>
          )}
        </div>

        {/* Banners */}
        {successMsg && (
          <div className="flex items-center gap-2 bg-green-500/15 border border-green-500/30 text-green-300 text-sm rounded-lg px-4 py-2.5">
            <Check className="w-4 h-4" /> {successMsg}
          </div>
        )}
        {errMsg && (
          <div className="flex items-center justify-between bg-red-500/15 border border-red-500/30 text-red-300 text-sm rounded-lg px-4 py-2.5">
            {errMsg}
            <button onClick={() => setErrMsg(null)}><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Tabs (hidden if only one) */}
        {tabs.length > 1 && (
          <div className="flex bg-white/5 rounded-lg p-1">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'flex-1 py-2 text-sm font-medium rounded-md transition-colors',
                  activeTab === tab ? 'bg-rogan-600 text-white' : 'text-white/50 hover:text-white'
                )}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        )}

        {/* Create Tier Form */}
        {showCreate && (
          <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-3">
            <h3 className="text-white font-semibold">Create Subscription Tier</h3>
            <input
              type="text" placeholder="Tier Name (e.g. VIP Fan)" value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50"
            />
            <input
              type="number" placeholder="Price (TK / month)" value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50"
            />
            <input
              type="text" placeholder="Perks (comma-separated, optional)" value={newPerks}
              onChange={(e) => setNewPerks(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreateTier} disabled={isLoading}
                className="flex-1 py-2.5 bg-rogan-600 text-white font-medium rounded-lg text-sm disabled:opacity-50"
              >
                {isLoading ? 'Creating…' : 'Create Tier'}
              </button>
              <button onClick={() => setShowCreate(false)} className="px-4 py-2.5 bg-white/5 text-white/60 rounded-lg text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── My Tiers ── */}
        {activeTab === 'tiers' && (
          tiers.length === 0 ? (
            <EmptyState icon={Crown} title="No Subscription Tiers" description="Create up to 3 tiers to offer your fans exclusive perks!" />
          ) : (
            <div className={cn('grid gap-4', isMobile ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-3')}>
              {tiers.map((tier) => (
                <TierCard key={tier.id} tier={tier} isLoading={isLoading} onSubscribe={() => handleSubscribe(tier)} />
              ))}
            </div>
          )
        )}

        {/* ── Subscribed To ── */}
        {activeTab === 'subscribed' && (
          mySubscriptions.length === 0 ? (
            <EmptyState
              icon={Crown}
              title="No Active Subscriptions"
              description="Visit a creator's profile to subscribe and unlock exclusive perks!"
            />
          ) : (
            <div className="space-y-3">
              {mySubscriptions.map((sub) => {
                const displayName = sub.creator_display_name || sub.creator_username || sub.creator_id.slice(0, 8);
                const initial = displayName.charAt(0).toUpperCase();
                return (
                  <div key={sub.id} className="bg-surface rounded-xl p-4 border border-white/5 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                      {initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">{displayName}</p>
                      <p className="text-white/40 text-xs capitalize">
                        {sub.tier} · {formatTK(sub.price)} TK/mo
                        {sub.expires_at ? ` · expires ${new Date(sub.expires_at).toLocaleDateString()}` : ''}
                      </p>
                    </div>
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full mr-2',
                      sub.is_active ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-white/40'
                    )}>
                      {sub.is_active ? 'Active' : sub.status}
                    </span>
                    {sub.is_active && (
                      <button
                        onClick={() => handleCancel(sub.id)}
                        className="px-3 py-1 bg-white/5 hover:bg-red-500/20 text-white/40 hover:text-red-400 text-xs rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ── My Subscribers ── */}
        {activeTab === 'subscribers' && (
          mySubscribers.length === 0 ? (
            <EmptyState icon={Crown} title="No Subscribers Yet" description="Create compelling tiers to attract subscribers!" />
          ) : (
            <div className="space-y-3">
              {mySubscribers.map((sub) => {
                const displayName = sub.subscriber_username || sub.subscriber_id.slice(0, 8);
                const initial = displayName.charAt(0).toUpperCase();
                return (
                  <div key={sub.id} className="bg-surface rounded-xl p-4 border border-white/5 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                      {initial}
                    </div>
                    <div className="flex-1">
                      <p className="text-white text-sm font-medium">@{displayName}</p>
                      <p className="text-white/40 text-xs capitalize">
                        {sub.tier} · {formatTK(sub.price)} TK/mo
                        {sub.expires_at ? ` · until ${new Date(sub.expires_at).toLocaleDateString()}` : ''}
                      </p>
                    </div>
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full',
                      sub.is_active ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-white/40'
                    )}>
                      {sub.is_active ? 'Active' : sub.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )
        )}

      </div>
    </div>
  );
}
