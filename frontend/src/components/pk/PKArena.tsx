'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Swords, Timer, Trophy, Zap, Search, X, Gift, Crown, Shield, CheckCircle, XCircle, Clock } from 'lucide-react';
import { usePKStore } from '@/stores/pkStore';
import { useAuthStore } from '@/stores/authStore';
import { useWalletStore } from '@/stores/walletStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { PKBattleWSClient } from '@/lib/ws';
import { cn, formatTK } from '@/lib/utils';
import api from '@/lib/api';
import EmptyState from '@/components/shared/EmptyState';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import type { PKBattle } from '@/types';

// ─── Types ─────────────────────────────────────────────────────────────────

interface CreatorSuggestion {
  id: string;
  username: string;
  avatar: string | null;
  is_live: boolean;
}

interface LiveScores {
  a: number;
  b: number;
}

// ─── Countdown Timer ────────────────────────────────────────────────────────

function useCountdown(startedAt: string | null, durationMinutes: number) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!startedAt) { setSecondsLeft(null); return; }
    const endMs = new Date(startedAt).getTime() + durationMinutes * 60 * 1000;

    const tick = () => {
      const left = Math.max(0, Math.floor((endMs - Date.now()) / 1000));
      setSecondsLeft(left);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, durationMinutes]);

  if (secondsLeft === null) return '--:--';
  const m = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const s = (secondsLeft % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ─── Score Bar ─────────────────────────────────────────────────────────────

function ScoreBar({ scoreA, scoreB, usernameA, usernameB }: {
  scoreA: number; scoreB: number; usernameA?: string | null; usernameB?: string | null;
}) {
  const total = scoreA + scoreB || 1;
  const pctA = Math.round((scoreA / total) * 100);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-rogan-400 font-semibold">@{usernameA || 'Creator A'}</span>
        <span className="text-blue-400 font-semibold">@{usernameB || 'Creator B'}</span>
      </div>
      <div className="h-4 bg-white/5 rounded-full overflow-hidden flex">
        <div
          className="bg-gradient-to-r from-rogan-600 to-rogan-500 transition-all duration-700"
          style={{ width: `${pctA}%` }}
        />
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 flex-1 transition-all duration-700" />
      </div>
      <div className="flex items-center justify-between text-xs font-mono">
        <span className="text-rogan-400">{formatTK(scoreA)} TK</span>
        <span className="text-white/40">{pctA}% — {100 - pctA}%</span>
        <span className="text-blue-400">{formatTK(scoreB)} TK</span>
      </div>
    </div>
  );
}

// ─── Gift Feed ──────────────────────────────────────────────────────────────

interface GiftFeedEntry { id: string; text: string; side: 'a' | 'b'; ts: number; }

function GiftFeed({ entries }: { entries: GiftFeedEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="space-y-1 max-h-24 overflow-hidden">
      {entries.slice(-4).reverse().map((e) => (
        <div
          key={e.id}
          className={cn(
            'text-xs px-3 py-1 rounded-full w-fit',
            e.side === 'a' ? 'bg-rogan-600/20 text-rogan-300' : 'bg-blue-600/20 text-blue-300',
          )}
        >
          {e.text}
        </div>
      ))}
    </div>
  );
}

// ─── Winner Overlay ─────────────────────────────────────────────────────────

function WinnerOverlay({ battle, onClose }: { battle: PKBattle; onClose: () => void }) {
  const isDraw = !battle.winner_id;
  const winnerUsername =
    battle.winner_id === battle.creator_a_id
      ? (battle as any).creator_a_username
      : (battle as any).creator_b_username;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-surface border border-white/10 rounded-2xl p-8 max-w-sm w-full mx-4 text-center space-y-4 shadow-2xl">
        {isDraw ? (
          <>
            <div className="w-16 h-16 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto">
              <Shield className="w-8 h-8 text-yellow-400" />
            </div>
            <h3 className="text-2xl font-bold text-white">It's a Draw!</h3>
            <p className="text-white/60 text-sm">Both creators receive their bonus pool back.</p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto animate-bounce">
              <Crown className="w-8 h-8 text-yellow-400" />
            </div>
            <h3 className="text-2xl font-bold text-white">
              @{winnerUsername || 'Winner'} wins!
            </h3>
            <p className="text-white/60 text-sm">They take the bonus pool from both sides.</p>
          </>
        )}
        <div className="pt-2">
          <ScoreBar
            scoreA={battle.creator_a_score}
            scoreB={battle.creator_b_score}
            usernameA={(battle as any).creator_a_username}
            usernameB={(battle as any).creator_b_username}
          />
        </div>
        <button
          onClick={onClose}
          className="w-full py-2.5 bg-rogan-600 hover:bg-rogan-700 text-white font-semibold rounded-xl text-sm transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ─── Battle Card ─────────────────────────────────────────────────────────────

function BattleCard({ battle, currentUserId }: { battle: PKBattle; currentUserId?: string }) {
  const { sendBattleGift } = usePKStore();
  const [sending, setSending] = useState(false);

  const isParticipant = currentUserId === battle.creator_a_id || currentUserId === battle.creator_b_id;
  const countdown = useCountdown(battle.started_at, battle.duration_minutes);

  const handleGift = async (side: 'a' | 'b', amount: number) => {
    if (sending) return;
    setSending(true);
    try {
      await sendBattleGift(battle.id, { amount_tk: amount, side });
    } catch { /* ignore */ } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-surface border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Swords className="w-4 h-4 text-rogan-400" />
          <span className="text-white text-sm font-semibold">PK Battle</span>
        </div>
        <div className="flex items-center gap-1.5 text-white/50 text-xs">
          <Timer className="w-3.5 h-3.5" />
          <span className="font-mono">{countdown}</span>
        </div>
      </div>

      <ScoreBar
        scoreA={battle.creator_a_score}
        scoreB={battle.creator_b_score}
        usernameA={(battle as any).creator_a_username}
        usernameB={(battle as any).creator_b_username}
      />

      {!isParticipant && battle.status === 'active' && (
        <div className="grid grid-cols-2 gap-2">
          {[10, 50, 100].map((amt) => (
            <button
              key={`a-${amt}`}
              onClick={() => handleGift('a', amt)}
              disabled={sending}
              className="py-2 bg-rogan-600/20 hover:bg-rogan-600/30 text-rogan-400 text-xs rounded-lg transition-colors disabled:opacity-40"
            >
              +{amt} TK → A
            </button>
          ))}
          {[10, 50, 100].map((amt) => (
            <button
              key={`b-${amt}`}
              onClick={() => handleGift('b', amt)}
              disabled={sending}
              className="py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs rounded-lg transition-colors disabled:opacity-40"
            >
              +{amt} TK → B
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main PKArena ─────────────────────────────────────────────────────────────

export default function PKArena() {
  const { user } = useAuthStore();
  const { wallet } = useWalletStore();
  const { activeBattles, currentBattle, isLoading, createBattle, acceptBattle, endBattle,
          fetchActiveBattles, fetchBattle } = usePKStore();
  const isMobile = useIsMobile(960);

  // Challenge state
  const [showChallenge, setShowChallenge] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<CreatorSuggestion[]>([]);
  const [target, setTarget] = useState<CreatorSuggestion | null>(null);
  const [duration, setDuration] = useState(5);
  const [challenging, setChallenging] = useState(false);

  // Live scores for current battle
  const [liveScores, setLiveScores] = useState<LiveScores | null>(null);
  const [giftFeed, setGiftFeed] = useState<GiftFeedEntry[]>([]);
  const pkWsRef = useRef<InstanceType<typeof PKBattleWSClient> | null>(null);

  // Pending challenge (where this creator is creator_b)
  const [pendingBattle, setPendingBattle] = useState<PKBattle | null>(null);
  const [winnerBattle, setWinnerBattle] = useState<PKBattle | null>(null);

  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') || '' : '';

  // Load active battles on mount
  useEffect(() => {
    fetchActiveBattles();
    const interval = setInterval(fetchActiveBattles, 15000);
    return () => clearInterval(interval);
  }, [fetchActiveBattles]);

  // Poll for incoming challenges (where user is creator_b and status=pending)
  useEffect(() => {
    if (!user?.id) return;
    const check = async () => {
      try {
        const res = await api.get(`/pk-battles/creator/${user.id}/active`);
        const b = res.data.battle;
        if (b && b.status === 'pending' && b.creator_b_id === user.id) {
          setPendingBattle(b);
        } else if (b && b.status === 'active') {
          setPendingBattle(null);
        }
      } catch { /* ignore */ }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [user?.id]);

  // Creator search autocomplete
  useEffect(() => {
    if (!query || query.length < 2) { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await api.get(`/creators/search?q=${encodeURIComponent(query)}`);
        setSuggestions((res.data.creators || []).filter((c: CreatorSuggestion) => c.id !== user?.id));
      } catch { setSuggestions([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [query, user?.id]);

  // Connect PK WebSocket when there's an active battle for this user
  useEffect(() => {
    const battle = currentBattle || battles.find(
      (b) => b.creator_a_id === user?.id || b.creator_b_id === user?.id
    );
    if (!battle || battle.status !== 'active' || !user?.id || !token) return;

    const ws = new PKBattleWSClient({
      battleId: battle.id,
      userId: user.id,
      token,
      onScoreUpdate: ({ creator_a_score, creator_b_score, sender_username, amount_tk, side }) => {
        setLiveScores({ a: creator_a_score, b: creator_b_score });
        if (sender_username && amount_tk) {
          setGiftFeed((prev) => [
            ...prev.slice(-9),
            {
              id: String(Date.now()),
              text: `${sender_username} +${amount_tk} TK → ${side?.toUpperCase()}`,
              side: side ?? 'a',
              ts: Date.now(),
            },
          ]);
        }
      },
      onBattleEnded: async (data) => {
        const updated = await fetchBattle(battle.id);
        if (updated) setWinnerBattle({ ...updated, winner_id: data.winner_id } as any);
      },
    });
    ws.connect();
    pkWsRef.current = ws;
    return () => { ws.disconnect(); pkWsRef.current = null; };
  }, [currentBattle?.id, user?.id, token]);

  const handleChallenge = async () => {
    if (!target) return;
    setChallenging(true);
    try {
      const battle = await createBattle({ creator_b_id: target.id, duration_minutes: duration });
      setShowChallenge(false);
      setTarget(null);
      setQuery('');
      await fetchBattle(battle.id);
    } catch { /* error shown via store */ } finally {
      setChallenging(false);
    }
  };

  const handleAccept = async (battleId: string) => {
    await acceptBattle(battleId);
    setPendingBattle(null);
    await fetchBattle(battleId);
  };

  const handleDecline = async (battleId: string) => {
    try { await api.post(`/pk-battles/${battleId}/end`); } catch { /* ignore */ }
    setPendingBattle(null);
  };

  const handleEndBattle = async (battleId: string) => {
    await endBattle(battleId);
    setLiveScores(null);
    setGiftFeed([]);
  };

  const battles = Array.isArray(activeBattles) ? activeBattles : [];

  const myActiveBattle = currentBattle?.status === 'active' ? currentBattle
    : battles.find((b) => b.creator_a_id === user?.id || b.creator_b_id === user?.id);

  // Must be called unconditionally at top level — never inside JSX
  const myBattleCountdown = useCountdown(
    myActiveBattle?.started_at ?? null,
    myActiveBattle?.duration_minutes ?? 0
  );

  const isCreator = user?.role === 'creator' || user?.role === 'admin';

  return (
    <div className={cn('h-full overflow-y-auto scrollbar-thin', isMobile ? 'p-4 pb-24' : 'p-6')}>
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Swords className="w-5 h-5 text-rogan-500" /> PK Battles
            </h2>
            <p className="text-white/40 text-sm mt-0.5">Challenge creators — viewers pick a side</p>
          </div>
          {isCreator && !myActiveBattle && (
            <button
              onClick={() => setShowChallenge(true)}
              className="flex items-center gap-2 px-4 py-2 bg-rogan-600 hover:bg-rogan-700 text-white text-sm rounded-lg transition-colors"
            >
              <Swords className="w-4 h-4" /> Challenge
            </button>
          )}
        </div>

        {/* Incoming challenge banner */}
        {pendingBattle && (
          <div className="flex items-center justify-between bg-rogan-600/20 border border-rogan-500/40 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2">
              <Swords className="w-4 h-4 text-rogan-400" />
              <span className="text-white text-sm">
                <span className="font-semibold text-rogan-300">
                  @{(pendingBattle as any).creator_a_username || 'Someone'}
                </span> challenged you — {pendingBattle.duration_minutes}min
              </span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleAccept(pendingBattle.id)}
                className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg">
                <CheckCircle className="w-3.5 h-3.5" /> Accept
              </button>
              <button onClick={() => handleDecline(pendingBattle.id)}
                className="flex items-center gap-1 px-3 py-1.5 bg-red-600/40 hover:bg-red-600/60 text-red-300 text-xs rounded-lg">
                <XCircle className="w-3.5 h-3.5" /> Decline
              </button>
            </div>
          </div>
        )}

        {/* My active battle */}
        {myActiveBattle && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-white/60 text-xs uppercase tracking-wider">Your Battle</span>
              {(myActiveBattle.creator_a_id === user?.id || myActiveBattle.creator_b_id === user?.id) && (
                <button
                  onClick={() => handleEndBattle(myActiveBattle.id)}
                  className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs rounded-lg border border-red-600/30"
                >
                  End Battle
                </button>
              )}
            </div>
            <div className="bg-surface border border-rogan-500/30 rounded-xl p-4 space-y-3">
              <ScoreBar
                scoreA={liveScores?.a ?? myActiveBattle.creator_a_score}
                scoreB={liveScores?.b ?? myActiveBattle.creator_b_score}
                usernameA={(myActiveBattle as any).creator_a_username}
                usernameB={(myActiveBattle as any).creator_b_username}
              />
              <div className="flex items-center gap-1.5 text-white/40 text-xs">
                <Timer className="w-3.5 h-3.5" />
                <span className="font-mono">{myBattleCountdown}</span>
              </div>
              <GiftFeed entries={giftFeed} />
            </div>
          </div>
        )}

        {/* All active battles */}
        <div className="space-y-3">
          <span className="text-white/60 text-xs uppercase tracking-wider">Live Battles</span>
          {isLoading ? (
            <LoadingSpinner />
          ) : battles.filter((b) => b.id !== myActiveBattle?.id && b.status === 'active').length === 0 ? (
            <EmptyState icon={Swords} title="No active battles" description="Challenge a creator to start one" />
          ) : (
            battles
              .filter((b) => b.id !== myActiveBattle?.id && b.status === 'active')
              .map((battle) => (
                <BattleCard key={battle.id} battle={battle} currentUserId={user?.id} />
              ))
          )}
        </div>

      </div>

      {/* Challenge Modal */}
      {showChallenge && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4">
          <div className="bg-surface border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <h3 className="text-white font-semibold flex items-center gap-2">
                <Swords className="w-4 h-4 text-rogan-400" /> Challenge a Creator
              </h3>
              <button onClick={() => { setShowChallenge(false); setTarget(null); setQuery(''); }}>
                <X className="w-5 h-5 text-white/40 hover:text-white" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {target ? (
                <div className="flex items-center justify-between bg-white/5 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-rogan-600/30 flex items-center justify-center">
                      <span className="text-rogan-400 text-sm font-semibold">
                        {target.username[0].toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="text-white text-sm font-medium">@{target.username}</p>
                      {target.is_live && <p className="text-rogan-400 text-xs">● Live</p>}
                    </div>
                  </div>
                  <button onClick={() => setTarget(null)}>
                    <X className="w-4 h-4 text-white/40" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search creator username..."
                    className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-4 py-2.5 text-white text-sm focus:outline-none focus:border-rogan-500/50"
                  />
                  {suggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-surface-2 border border-white/10 rounded-lg overflow-hidden z-10">
                      {suggestions.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => { setTarget(s); setQuery(''); setSuggestions([]); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 text-left"
                        >
                          <div className="w-7 h-7 rounded-full bg-rogan-600/30 flex items-center justify-center flex-shrink-0">
                            <span className="text-rogan-400 text-xs font-bold">{s.username[0].toUpperCase()}</span>
                          </div>
                          <div>
                            <p className="text-white text-sm">@{s.username}</p>
                            {s.is_live && <p className="text-rogan-400 text-xs">● Live now</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-white/60 text-xs mb-2 block">Battle Duration</label>
                <div className="grid grid-cols-4 gap-2">
                  {[3, 5, 10, 15].map((d) => (
                    <button
                      key={d}
                      onClick={() => setDuration(d)}
                      className={cn('py-2 rounded-lg text-sm transition-colors', duration === d ? 'bg-rogan-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10')}
                    >
                      {d}m
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-white/30 text-xs">
                Viewers support each creator with TK gifts. Winner takes the bonus pool.
              </p>

              <button
                onClick={handleChallenge}
                disabled={!target || challenging}
                className="w-full py-3 bg-rogan-600 hover:bg-rogan-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {challenging ? 'Sending challenge…' : 'Send Challenge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
