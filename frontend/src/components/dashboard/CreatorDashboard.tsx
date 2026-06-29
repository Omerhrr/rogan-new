'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3, DollarSign, Radio, TrendingUp, Gift,
  Users, RefreshCw,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatTK, cn } from '@/lib/utils';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

interface DashboardData {
  user: { id: string; username: string; display_name: string | null; role: string; is_live: boolean };
  wallet: { tk_balance: number };
  gift_stats: {
    total_gifts_received: number;
    total_tk_earned: number;
    breakdown_by_type: Record<string, { count: number; total_tk: number }>;
  };
  recent_streams: {
    id: string; title: string; is_live: boolean; viewer_count: number;
    category: string | null; created_at: string | null; ended_at: string | null;
  }[];
  tk_balance: number;
  follower_count?: number;
  subscriber_count?: number;
  pk_wins?: number;
  pk_total?: number;
  sub_tier_count?: number;
}

interface ChartPoint { day: string; date: string; earnings: number }

export default function CreatorDashboard() {
  const isMobile = useIsMobile(960);
  const { user } = useAuthStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [chart, setChart] = useState<ChartPoint[]>([]);
  const [chartTotal, setChartTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    else setRefreshing(true);
    try {
      const [dashRes, chartRes] = await Promise.all([
        api.get('/creators/dashboard'),
        api.get('/creators/dashboard/earnings-chart'),
      ]);
      setData(dashRes.data);
      setChart(chartRes.data.chart || []);
      setChartTotal(chartRes.data.total || 0);
    } catch {
      // handled below via null check
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (isLoading) return <LoadingSpinner className="h-full" />;
  if (!data) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <p className="text-white/40">Dashboard unavailable</p>
        {user?.role !== 'creator' && (
          <p className="text-white/30 text-sm">You need to be a creator — upgrade in Settings.</p>
        )}
      </div>
    );
  }

  const statsTop = [
    { label: 'Total Earned', value: formatTK(data.gift_stats.total_tk_earned),      icon: DollarSign, color: 'text-tk' },
    { label: 'This Week',    value: formatTK(chartTotal),                            icon: TrendingUp, color: 'text-green-400' },
    { label: 'Followers',    value: (data.follower_count ?? 0).toLocaleString(),     icon: Users,      color: 'text-blue-400' },
    { label: 'Gifts Got',    value: (data.gift_stats.total_gifts_received).toString(), icon: Gift,     color: 'text-yellow-400' },
    { label: 'Streams',      value: (data.recent_streams?.length ?? 0).toString(),   icon: Radio,      color: 'text-purple-400' },
  ];

  return (
    <div className={cn('h-full overflow-y-auto scrollbar-thin', isMobile ? 'p-4 pb-24' : 'p-6')}>
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-rogan-500" />
              Creator Dashboard
            </h2>
            <p className="text-white/40 text-sm mt-0.5">
              Welcome back, {data.user.display_name || data.user.username}
            </p>
          </div>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          </button>
        </div>

        {/* Stats */}
        <div className={cn('grid gap-4', isMobile ? 'grid-cols-2' : 'grid-cols-5')}>
          {statsTop.map((s) => (
            <div key={s.label} className="bg-surface rounded-xl p-4 border border-white/5">
              <div className="flex items-center gap-2 mb-2">
                <s.icon className={cn('w-4 h-4', s.color)} />
                <span className="text-white/40 text-xs">{s.label}</span>
              </div>
              <p className="text-white text-xl font-bold">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Earnings chart */}
        <div className="bg-surface rounded-xl p-5 border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold">Earnings (Last 7 Days)</h3>
            <span className="text-tk text-sm font-medium">{formatTK(chartTotal)} this week</span>
          </div>
          {chart.length === 0 || chart.every((p) => p.earnings === 0) ? (
            <p className="text-white/30 text-sm text-center py-10">No earnings data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" stroke="rgba(255,255,255,0.3)" fontSize={12} />
                <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} tickFormatter={(v) => `${v}`} />
                <Tooltip
                  contentStyle={{ background: '#1A1A1A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white' }}
                  formatter={(val: number) => [`${val} TK`, 'Earnings']}
                />
                <Bar dataKey="earnings" fill="#E91E63" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Gift breakdown */}
        <div className="bg-surface rounded-xl p-5 border border-white/5">
          <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Gift className="w-4 h-4 text-rogan-400" /> Gift Breakdown
          </h3>
          {Object.keys(data.gift_stats.breakdown_by_type).length === 0 ? (
            <p className="text-white/30 text-sm text-center py-6">No gifts received yet</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {Object.entries(data.gift_stats.breakdown_by_type).map(([type, info]) => (
                <div key={type} className="bg-white/5 rounded-lg p-3 text-center">
                  <p className="text-white/60 text-xs capitalize mb-1">{type}</p>
                  <p className="text-white font-bold text-sm">{info.count}</p>
                  <p className="text-tk text-xs">{info.total_tk} TK</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent streams */}
        <div className="bg-surface rounded-xl border border-white/5">
          <div className="p-4 border-b border-white/5">
            <h3 className="text-white font-semibold">Recent Streams</h3>
          </div>
          {!data.recent_streams?.length ? (
            <p className="text-white/30 text-sm text-center py-6">No streams yet</p>
          ) : (
            <div className="divide-y divide-white/5">
              {data.recent_streams.map((stream) => (
                <div key={stream.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-10 h-10 rounded-lg bg-rogan-600/20 flex items-center justify-center flex-shrink-0">
                    <Radio className="w-5 h-5 text-rogan-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{stream.title}</p>
                    <p className="text-white/30 text-xs">
                      {stream.created_at ? new Date(stream.created_at).toLocaleDateString() : ''}
                      {stream.viewer_count > 0 && ` · ${stream.viewer_count} viewers`}
                    </p>
                  </div>
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full',
                    stream.is_live ? 'bg-rogan-600/20 text-rogan-400' : 'bg-white/5 text-white/40'
                  )}>
                    {stream.is_live ? '● LIVE' : 'Ended'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
