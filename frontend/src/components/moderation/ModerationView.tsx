'use client';

import { useState, useEffect } from 'react';
import { Shield, AlertTriangle, Check, X, Eye } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn, timeAgo } from '@/lib/utils';
import EmptyState from '@/components/shared/EmptyState';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import type { ModerationReport } from '@/types';

export default function ModerationView() {
  const { user } = useAuthStore();
  const isMobile = useIsMobile(960);
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user?.role !== 'admin') { setIsLoading(false); return; }
    api.get('/moderation/reports/')
      .then((res) => setReports(res.data.reports || res.data || []))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [user?.role]);

  const handleAction = async (reportId: string, action: string, reason?: string) => {
    try {
      await api.post(`/moderation/reports/${reportId}/action`, { action, reason: reason || 'Admin action' });
      setReports((prev) => prev.map((r) => r.id === reportId ? { ...r, status: action === 'dismiss' ? 'dismissed' : 'resolved' } : r));
    } catch {}
  };

  if (user?.role !== 'admin') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-12 h-12 text-white/10 mx-auto mb-3" />
          <p className="text-white/40">Admin access required</p>
        </div>
      </div>
    );
  }

  if (isLoading) return <LoadingSpinner className="h-full" />;

  return (
    <div className={cn('h-full overflow-y-auto scrollbar-thin', isMobile ? 'p-4 pb-24' : 'p-6')}>
      <div className="max-w-4xl mx-auto space-y-6">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Shield className="w-5 h-5 text-rogan-500" />
          Moderation
        </h2>

        {reports.length === 0 ? (
          <EmptyState icon={Shield} title="No Reports" description="All clear! No pending reports." />
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <div key={report.id} className="bg-surface rounded-xl p-4 border border-white/5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className={cn('w-4 h-4', report.priority >= 3 ? 'text-red-400' : 'text-amber-400')} />
                      <span className="text-white text-sm font-medium capitalize">{report.target_type} Report</span>
                      <span className={cn('text-xs px-2 py-0.5 rounded', report.status === 'pending' ? 'bg-amber-500/20 text-amber-400' : report.status === 'resolved' ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-white/40')}>
                        {report.status}
                      </span>
                    </div>
                    <p className="text-white/60 text-sm">{report.reason}</p>
                    <p className="text-white/30 text-xs mt-1">Target: {report.target_id} · {report.created_at ? timeAgo(report.created_at) : ''}</p>
                  </div>
                </div>
                {report.status === 'pending' && (
                  <div className="flex gap-2">
                    <button onClick={() => handleAction(report.id, 'warn')} className="px-3 py-1.5 bg-amber-500/10 text-amber-400 text-xs rounded-lg hover:bg-amber-500/20 transition-colors">Warn</button>
                    <button onClick={() => handleAction(report.id, 'mute')} className="px-3 py-1.5 bg-blue-500/10 text-blue-400 text-xs rounded-lg hover:bg-blue-500/20 transition-colors">Mute</button>
                    <button onClick={() => handleAction(report.id, 'ban')} className="px-3 py-1.5 bg-red-500/10 text-red-400 text-xs rounded-lg hover:bg-red-500/20 transition-colors">Ban</button>
                    <button onClick={() => handleAction(report.id, 'dismiss')} className="px-3 py-1.5 bg-white/5 text-white/40 text-xs rounded-lg hover:bg-white/10 transition-colors ml-auto">Dismiss</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
