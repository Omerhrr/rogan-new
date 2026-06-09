'use client';

import { useState, useEffect } from 'react';
import { Crown, Star, Zap, Plus } from 'lucide-react';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn, formatTK } from '@/lib/utils';
import EmptyState from '@/components/shared/EmptyState';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import type { SubscriptionTier } from '@/types';

const TIER_ICONS = { basic: Star, premium: Zap, vip: Crown };
const TIER_COLORS = { basic: 'text-blue-400', premium: 'text-purple-400', vip: 'text-amber-400' };
const TIER_BG = { basic: 'from-blue-600/20', premium: 'from-purple-600/20', vip: 'from-amber-600/20' };

export default function SubscriptionsView() {
  const { tiers, mySubscriptions, mySubscribers, fetchTiers, fetchMySubscriptions, fetchMySubscribers, createTier, subscribe, cancelSubscription, isLoading } = useSubscriptionStore();
  const { user } = useAuthStore();
  const isMobile = useIsMobile(960);
  const [activeTab, setActiveTab] = useState<'tiers' | 'subscribed' | 'subscribers'>('tiers');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newPerks, setNewPerks] = useState('');

  useEffect(() => {
    if (user?.id) fetchTiers(user.id);
    fetchMySubscriptions();
    if (user?.role === 'creator') fetchMySubscribers();
  }, [user?.id, user?.role, fetchTiers, fetchMySubscriptions, fetchMySubscribers]);

  const handleCreateTier = async () => {
    if (!newName.trim() || !newPrice) return;
    await createTier({
      name: newName,
      price_tk: parseFloat(newPrice),
      perks: newPerks ? newPerks.split(',').map(p => p.trim()) : undefined,
    });
    setShowCreate(false);
    setNewName('');
    setNewPrice('');
    setNewPerks('');
    if (user?.id) fetchTiers(user.id);
  };

  return (
    <div className={cn('h-full overflow-y-auto scrollbar-thin', isMobile ? 'p-4 pb-24' : 'p-6')}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Crown className="w-5 h-5 text-rogan-500" />
            Subscriptions
          </h2>
          {user?.role === 'creator' && (
            <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 bg-rogan-600 hover:bg-rogan-700 text-white text-sm font-medium rounded-lg flex items-center gap-2">
              <Plus className="w-4 h-4" /> Create Tier
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex bg-white/5 rounded-lg p-1">
          {(['tiers', 'subscribed', 'subscribers'] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={cn('flex-1 py-2 text-sm font-medium rounded-md transition-colors capitalize', activeTab === tab ? 'bg-rogan-600 text-white' : 'text-white/50 hover:text-white')}>
              {tab}
            </button>
          ))}
        </div>

        {/* Create Tier Form */}
        {showCreate && (
          <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-3">
            <h3 className="text-white font-semibold">Create Subscription Tier</h3>
            <input type="text" placeholder="Tier Name (e.g. VIP Fan)" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50" />
            <input type="number" placeholder="Price (TK/month)" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50" />
            <input type="text" placeholder="Perks (comma-separated)" value={newPerks} onChange={(e) => setNewPerks(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50" />
            <div className="flex gap-2">
              <button onClick={handleCreateTier} disabled={isLoading} className="flex-1 py-2.5 bg-rogan-600 text-white font-medium rounded-lg text-sm disabled:opacity-50">{isLoading ? 'Creating...' : 'Create Tier'}</button>
              <button onClick={() => setShowCreate(false)} className="px-4 py-2.5 bg-white/5 text-white/60 rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        )}

        {/* Tiers */}
        {activeTab === 'tiers' && (
          tiers.length === 0 ? (
            <EmptyState icon={Crown} title="No Subscription Tiers" description="Create tiers to offer your fans exclusive perks!" />
          ) : (
            <div className={cn('grid gap-4', isMobile ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-3')}>
              {tiers.map((tier) => {
                const tierLevel = tier.name.toLowerCase().includes('vip') ? 'vip' : tier.name.toLowerCase().includes('premium') ? 'premium' : 'basic';
                const Icon = TIER_ICONS[tierLevel];
                return (
                  <div key={tier.id} className={cn('bg-gradient-to-br to-surface rounded-xl p-5 border border-white/5', TIER_BG[tierLevel])}>
                    <div className="flex items-center gap-2 mb-3">
                      <Icon className={cn('w-5 h-5', TIER_COLORS[tierLevel])} />
                      <h3 className="text-white font-semibold">{tier.name}</h3>
                    </div>
                    <p className="text-tk text-2xl font-bold mb-1">{formatTK(tier.price_tk)} <span className="text-sm font-normal text-white/40">TK/mo</span></p>
                    {tier.perks && (
                      <ul className="space-y-1 mb-4">
                        {(typeof tier.perks === 'string' ? JSON.parse(tier.perks) : tier.perks).map((perk: string, i: number) => (
                          <li key={i} className="text-white/50 text-xs flex items-center gap-1">✓ {perk}</li>
                        ))}
                      </ul>
                    )}
                    <button onClick={() => subscribe({ creator_id: tier.creator_id, tier_id: tier.id })} disabled={isLoading} className="w-full py-2 bg-rogan-600 hover:bg-rogan-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                      Subscribe
                    </button>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* My Subscriptions */}
        {activeTab === 'subscribed' && (
          mySubscriptions.length === 0 ? (
            <EmptyState icon={Crown} title="No Subscriptions" description="Subscribe to creators to unlock exclusive content!" />
          ) : (
            <div className="space-y-3">
              {mySubscriptions.map((sub) => (
                <div key={sub.id} className="bg-surface rounded-xl p-4 border border-white/5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-sm font-bold">C</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{sub.tier} tier</p>
                    <p className="text-white/30 text-xs">{formatTK(sub.price)} TK/mo · {sub.is_active ? 'Active' : 'Inactive'}</p>
                  </div>
                  {sub.is_active && (
                    <button onClick={() => cancelSubscription(sub.id)} className="px-3 py-1 bg-white/5 hover:bg-red-500/20 text-white/40 hover:text-red-400 text-xs rounded-lg transition-colors">Cancel</button>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {/* My Subscribers */}
        {activeTab === 'subscribers' && (
          mySubscribers.length === 0 ? (
            <EmptyState icon={Crown} title="No Subscribers Yet" description="Create compelling tiers to attract subscribers!" />
          ) : (
            <div className="space-y-3">
              {mySubscribers.map((sub) => (
                <div key={sub.id} className="bg-surface rounded-xl p-4 border border-white/5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-sm font-bold">
                    {sub.subscriber_id.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="text-white text-sm font-medium">{sub.tier} subscriber</p>
                    <p className="text-white/30 text-xs">{formatTK(sub.price)} TK/mo · {sub.status}</p>
                  </div>
                  <span className={cn('text-xs px-2 py-0.5 rounded', sub.is_active ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-white/40')}>
                    {sub.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
