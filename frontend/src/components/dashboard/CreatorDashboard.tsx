'use client';

import { useState, useEffect } from 'react';
import { BarChart3, Users, DollarSign, Radio, TrendingUp, Gift } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '@/lib/api';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatTK, cn } from '@/lib/utils';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import type { CreatorDashboard as CreatorDashboardType } from '@/types';

export default function CreatorDashboard() {
  const isMobile = useIsMobile(960);
  const [data, setData] = useState<CreatorDashboardType | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api.get('/creators/dashboard')
      .then((res) => setData(res.data))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return <LoadingSpinner className="h-full" />;
  if (!data) return <div className="h-full flex items-center justify-center"><p className="text-white/40">Dashboard data unavailable</p></div>;

  const stats = [
    { label: 'TK Balance', value: formatTK(data.tk_balance), icon: DollarSign, color: 'text-tk' },
    { label: 'Total Gifts', value: data.gift_stats?.total_received || 0, icon: Gift, color: 'text-rogan-500' },
    { label: 'Total TK Earned', value: formatTK(data.gift_stats?.total_tk || 0), icon: TrendingUp, color: 'text-green-400' },
    { label: 'Recent Streams', value: data.recent_streams?.length || 0, icon: Radio, color: 'text-blue-400' },
  ];

  // Mock 7-day chart data (in production, backend would provide this)
  const chartData = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => ({
    day,
    earnings: Math.floor(Math.random() * 500 + 50),
  }));

  return (
    <div className={cn('h-full overflow-y-auto scrollbar-thin', isMobile ? 'p-4 pb-24' : 'p-6')}>
      <div className="max-w-5xl mx-auto space-y-6">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-rogan-500" />
          Creator Dashboard
        </h2>

        {/* Stats Grid */}
        <div className={cn('grid gap-4', isMobile ? 'grid-cols-2' : 'grid-cols-4')}>
          {stats.map((stat) => (
            <div key={stat.label} className="bg-surface rounded-xl p-4 border border-white/5">
              <div className="flex items-center gap-2 mb-2">
                <stat.icon className={cn('w-4 h-4', stat.color)} />
                <span className="text-white/40 text-xs">{stat.label}</span>
              </div>
              <p className="text-white text-xl font-bold">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Earnings Chart */}
        <div className="bg-surface rounded-xl p-5 border border-white/5">
          <h3 className="text-white font-semibold mb-4">7-Day Earnings</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="day" stroke="rgba(255,255,255,0.3)" fontSize={12} />
              <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} />
              <Tooltip contentStyle={{ background: '#1A1A1A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white' }} />
              <Bar dataKey="earnings" fill="#E91E63" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Recent Streams */}
        <div className="bg-surface rounded-xl border border-white/5">
          <div className="p-4 border-b border-white/5">
            <h3 className="text-white font-semibold">Recent Streams</h3>
          </div>
          {data.recent_streams?.length === 0 ? (
            <p className="text-white/30 text-sm text-center py-6">No streams yet</p>
          ) : (
            <div className="divide-y divide-white/5">
              {data.recent_streams?.map((stream) => (
                <div key={stream.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-10 h-10 rounded-lg bg-rogan-600/20 flex items-center justify-center">
                    <Radio className="w-5 h-5 text-rogan-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{stream.title}</p>
                    <p className="text-white/30 text-xs">{stream.created_at ? new Date(stream.created_at).toLocaleDateString() : ''}</p>
                  </div>
                  <span className={cn('text-xs px-2 py-0.5 rounded', stream.is_live ? 'bg-rogan-600/20 text-rogan-400' : 'bg-white/5 text-white/40')}>
                    {stream.is_live ? 'LIVE' : 'Ended'}
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
