'use client';

import { useState, useEffect } from 'react';
import { Swords, Timer, Trophy, Zap } from 'lucide-react';
import { usePKStore } from '@/stores/pkStore';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn, formatTK } from '@/lib/utils';
import EmptyState from '@/components/shared/EmptyState';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

export default function PKArena() {
  const { activeBattles, currentBattle, fetchActiveBattles, createBattle, sendBattleGift, isLoading } = usePKStore();
  const { user } = useAuthStore();
  const isMobile = useIsMobile(960);
  const [challengeId, setChallengeId] = useState('');
  const [duration, setDuration] = useState('5');
  const [giftAmount, setGiftAmount] = useState('10');
  const [giftSide, setGiftSide] = useState<'a' | 'b'>('a');

  useEffect(() => { fetchActiveBattles(); }, [fetchActiveBattles]);

  const handleChallenge = async () => {
    if (!challengeId.trim()) return;
    try {
      await createBattle({ creator_b_id: challengeId, duration_minutes: parseInt(duration) });
      setChallengeId('');
    } catch {}
  };

  const handleGift = async (battleId: string) => {
    try {
      await sendBattleGift(battleId, { amount_tk: parseFloat(giftAmount), side: giftSide });
    } catch {}
  };

  return (
    <div className={cn('h-full overflow-y-auto scrollbar-thin', isMobile ? 'p-4 pb-24' : 'p-6')}>
      <div className="max-w-4xl mx-auto space-y-6">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Swords className="w-5 h-5 text-rogan-500" />
          PK Arena
        </h2>

        {/* Challenge Form (creators only) */}
        {user?.role === 'creator' && (
          <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-3">
            <h3 className="text-white font-semibold">Challenge a Creator</h3>
            <input type="text" placeholder="Creator User ID" value={challengeId} onChange={(e) => setChallengeId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50" />
            <select value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-rogan-500/50">
              <option value="3">3 Minutes</option>
              <option value="5">5 Minutes</option>
              <option value="10">10 Minutes</option>
              <option value="15">15 Minutes</option>
            </select>
            <button onClick={handleChallenge} disabled={isLoading || !challengeId.trim()} className="w-full py-2.5 bg-rogan-600 hover:bg-rogan-700 text-white font-medium rounded-lg text-sm transition-colors disabled:opacity-50">
              {isLoading ? 'Creating...' : 'Send Challenge'}
            </button>
          </div>
        )}

        {/* Current Battle */}
        {currentBattle && (
          <div className="bg-surface rounded-xl p-5 border border-white/5">
            <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
              <Zap className="w-4 h-4 text-tk" />
              Battle in Progress
            </h3>
            {/* Score Bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-rogan-400 font-medium">Creator A: {formatTK(currentBattle.creator_a_score)} TK</span>
                <span className="text-blue-400 font-medium">Creator B: {formatTK(currentBattle.creator_b_score)} TK</span>
              </div>
              <div className="h-3 bg-white/5 rounded-full overflow-hidden flex">
                <div className="bg-rogan-600 transition-all duration-500" style={{ width: `${(currentBattle.creator_a_score / (currentBattle.creator_a_score + currentBattle.creator_b_score || 1)) * 100}%` }} />
                <div className="bg-blue-600 flex-1" />
              </div>
            </div>
            {/* Support with Gift */}
            <div className="flex items-center gap-2">
              <select value={giftSide} onChange={(e) => setGiftSide(e.target.value as 'a' | 'b')} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
                <option value="a">Side A</option>
                <option value="b">Side B</option>
              </select>
              <input type="number" placeholder="TK Amount" value={giftAmount} onChange={(e) => setGiftAmount(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none" />
              <button onClick={() => handleGift(currentBattle.id)} className="px-4 py-2 bg-tk/20 hover:bg-tk/30 text-tk font-medium rounded-lg text-sm transition-colors">
                Support
              </button>
            </div>
          </div>
        )}

        {/* Active Battles List */}
        <div className="bg-surface rounded-xl border border-white/5">
          <div className="p-4 border-b border-white/5">
            <h3 className="text-white font-semibold">Active Battles</h3>
          </div>
          {activeBattles.length === 0 ? (
            <EmptyState icon={Swords} title="No Active Battles" description="Challenge a creator to start a PK battle!" />
          ) : (
            <div className="divide-y divide-white/5">
              {activeBattles.map((battle) => (
                <div key={battle.id} className="flex items-center gap-3 px-4 py-3">
                  <Swords className="w-5 h-5 text-rogan-400" />
                  <div className="flex-1">
                    <p className="text-white text-sm">{battle.creator_a_id} vs {battle.creator_b_id}</p>
                    <p className="text-white/30 text-xs">{battle.status} · {battle.duration_minutes}min</p>
                  </div>
                  <span className="text-tk text-xs">{formatTK(battle.creator_a_score)} - {formatTK(battle.creator_b_score)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
