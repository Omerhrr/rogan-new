'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Shield, Users, Radio, BarChart2, AlertTriangle, Search, X,
  ChevronLeft, ChevronRight, Ban, CheckCircle, UserCheck,
  ArrowUpDown, RefreshCw, Trash2, Crown, Zap, Activity,
  DollarSign, Flag, Eye, EyeOff,
} from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn, timeAgo, formatTK } from '@/lib/utils';
import EmptyState from '@/components/shared/EmptyState';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface AdminStats {
  users: { total: number; creators: number; moderators: number; admins: number; new_last_7d: number };
  streams: { active: number; total: number };
  economy: { total_tk_gifted: number; total_transactions: number };
  moderation: { pending_reports: number; active_bans: number };
}

interface AdminUser {
  id: string;
  username: string;
  display_name: string | null;
  email: string;
  role: string;
  is_active: boolean;
  is_live: boolean;
  avatar: string | null;
  created_at: string | null;
  stream_count?: number;
  active_ban?: { id: string; ban_type: string; reason: string; expires_at: string | null } | null;
}

interface AdminStream {
  id: string;
  title: string;
  creator_id: string;
  creator_username: string | null;
  creator_display_name: string | null;
  is_live: boolean;
  is_private: boolean;
  viewer_count: number;
  category: string | null;
  created_at: string | null;
  ended_at: string | null;
}

interface AdminTransaction {
  id: string;
  type: string;
  amount: number;
  from_user_id: string;
  from_username: string | null;
  to_user_id: string;
  to_username: string | null;
  reference_id: string | null;
  created_at: string | null;
}

interface Report {
  id: string;
  reporter_id: string;
  reporter_username: string | null;
  target_type: string;
  target_id: string;
  target_username: string | null;
  reason: string;
  status: string;
  priority: number;
  created_at: string | null;
}

interface Appeal {
  id: string;
  user_id: string;
  username: string | null;
  ban_id: string | null;
  reason: string;
  status: string;
  reviewer_note: string | null;
  created_at: string | null;
  reviewed_at: string | null;
}

type Tab = 'overview' | 'users' | 'streams' | 'reports' | 'appeals' | 'transactions' | 'economy' | 'creators' | 'withdrawals' | 'settings';

const ROLES = ['user', 'creator', 'moderator', 'admin'] as const;
type Role = typeof ROLES[number];

// ─── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string;
  icon: React.ComponentType<{ className?: string }>; color: string;
}) {
  return (
    <div className="bg-surface border border-white/5 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-white/50 text-sm">{label}</span>
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', color)}>
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        {sub && <p className="text-xs text-white/40 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Role Badge ─────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    admin: 'bg-red-500/20 text-red-400',
    moderator: 'bg-blue-500/20 text-blue-400',
    creator: 'bg-rogan-500/20 text-rogan-400',
    user: 'bg-white/10 text-white/50',
  };
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded font-medium', colors[role] ?? colors.user)}>
      {role}
    </span>
  );
}

// ─── Pagination ────────────────────────────────────────────────────────────────

function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 pt-4">
      <button onClick={() => onPage(page - 1)} disabled={page === 1}
        className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-sm text-white/60">Page {page} of {pages}</span>
      <button onClick={() => onPage(page + 1)} disabled={page === pages}
        className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/stats')
      .then((r) => setStats(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner className="py-20" />;
  if (!stats) return <EmptyState icon={BarChart2} title="Failed to load stats" description="Could not fetch platform statistics." />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Users" value={stats.users.total} sub={`+${stats.users.new_last_7d} this week`} icon={Users} color="bg-blue-600" />
        <StatCard label="Creators" value={stats.users.creators} icon={Crown} color="bg-rogan-600" />
        <StatCard label="Active Streams" value={stats.streams.active} sub={`${stats.streams.total} total`} icon={Radio} color="bg-green-600" />
        <StatCard label="TK Gifted" value={formatTK(stats.economy.total_tk_gifted)} sub={`${stats.economy.total_transactions} transactions`} icon={Zap} color="bg-amber-600" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Moderators" value={stats.users.moderators} icon={Shield} color="bg-blue-700" />
        <StatCard label="Admins" value={stats.users.admins} icon={UserCheck} color="bg-red-700" />
        <StatCard label="Pending Reports" value={stats.moderation.pending_reports} icon={AlertTriangle} color="bg-orange-600" />
        <StatCard label="Active Bans" value={stats.moderation.active_bans} icon={Ban} color="bg-red-600" />
      </div>
    </div>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab() {
  const { user: me } = useAuthStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async (pg = page) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page: pg, limit: 25 };
      if (q) params.q = q;
      if (roleFilter) params.role = roleFilter;
      const r = await api.get('/admin/users', { params });
      setUsers(r.data.users);
      setTotal(r.data.total);
      setPages(r.data.pages);
    } catch { } finally { setLoading(false); }
  }, [page, q, roleFilter]);

  useEffect(() => { load(1); setPage(1); }, [q, roleFilter]); // eslint-disable-line
  useEffect(() => { load(page); }, [page]); // eslint-disable-line

  const flash = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 3000); };

  const changeRole = async (userId: string, role: Role) => {
    setActionLoading(true);
    try {
      await api.patch(`/admin/users/${userId}/role`, { role });
      flash(`Role updated to ${role}`);
      load(page);
      if (selectedUser?.id === userId) setSelectedUser((u) => u ? { ...u, role } : u);
    } catch (e) { flash(getErrorMessage(e), false); }
    finally { setActionLoading(false); }
  };

  const toggleStatus = async (userId: string) => {
    setActionLoading(true);
    try {
      const r = await api.patch(`/admin/users/${userId}/status`);
      flash(r.data.message);
      load(page);
      if (selectedUser?.id === userId) setSelectedUser((u) => u ? { ...u, is_active: r.data.is_active } : u);
    } catch (e) { flash(getErrorMessage(e), false); }
    finally { setActionLoading(false); }
  };

  const banUser = async (userId: string) => {
    const reason = prompt('Ban reason:');
    if (!reason) return;
    setActionLoading(true);
    try {
      await api.post(`/admin/users/${userId}/ban`, { reason, ban_type: 'full_ban' });
      flash('User banned');
      load(page);
    } catch (e) { flash(getErrorMessage(e), false); }
    finally { setActionLoading(false); }
  };

  const unbanUser = async (userId: string) => {
    setActionLoading(true);
    try {
      await api.post(`/admin/users/${userId}/unban`);
      flash('Ban lifted');
      load(page);
      if (selectedUser?.id === userId) setSelectedUser((u) => u ? { ...u, active_ban: null } : u);
    } catch (e) { flash(getErrorMessage(e), false); }
    finally { setActionLoading(false); }
  };

  return (
    <div className="space-y-4">
      {msg && (
        <div className={cn('px-4 py-2 rounded-lg text-sm', msg.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
          {msg.text}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search username or email…"
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-rogan-500/50"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-rogan-500/50"
        >
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button onClick={() => load(page)} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors">
          <RefreshCw className="w-4 h-4 text-white/60" />
        </button>
      </div>

      <p className="text-xs text-white/40">{total} users found</p>

      {loading ? <LoadingSpinner className="py-12" /> : (
        <div className="space-y-2">
          {users.map((u) => (
            <div
              key={u.id}
              className={cn('bg-surface border rounded-xl p-3 cursor-pointer transition-colors hover:border-white/20',
                selectedUser?.id === u.id ? 'border-rogan-500/40' : 'border-white/5')}
              onClick={() => setSelectedUser(selectedUser?.id === u.id ? null : u)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">
                    {(u.display_name || u.username || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white text-sm font-medium">@{u.username}</span>
                      <RoleBadge role={u.role} />
                      {!u.is_active && <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">suspended</span>}
                      {u.active_ban && <span className="text-xs bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded">banned</span>}
                      {u.is_live && <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded animate-pulse">LIVE</span>}
                    </div>
                    <p className="text-xs text-white/40 truncate">{u.email}</p>
                  </div>
                </div>
                <p className="text-xs text-white/30 flex-shrink-0 ml-2">{u.created_at ? timeAgo(u.created_at) : ''}</p>
              </div>

              {/* Expanded actions */}
              {selectedUser?.id === u.id && (
                <div className="mt-3 pt-3 border-t border-white/5 space-y-3" onClick={(e) => e.stopPropagation()}>
                  {/* Role selector */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-white/40">Role:</span>
                    {ROLES.map((r) => (
                      <button
                        key={r}
                        disabled={actionLoading || (u.id === me?.id && r !== 'admin')}
                        onClick={() => changeRole(u.id, r)}
                        className={cn(
                          'text-xs px-2 py-1 rounded-lg border transition-colors disabled:opacity-40',
                          u.role === r
                            ? 'border-rogan-500 bg-rogan-600/20 text-rogan-300'
                            : 'border-white/10 text-white/50 hover:border-white/30 hover:text-white'
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 flex-wrap">
                    {u.id !== me?.id && (
                      <button
                        disabled={actionLoading}
                        onClick={() => toggleStatus(u.id)}
                        className={cn('flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40',
                          u.is_active ? 'bg-orange-500/10 text-orange-400 hover:bg-orange-500/20' : 'bg-green-500/10 text-green-400 hover:bg-green-500/20')}
                      >
                        {u.is_active ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        {u.is_active ? 'Suspend' : 'Activate'}
                      </button>
                    )}
                    {u.active_ban ? (
                      <button disabled={actionLoading} onClick={() => unbanUser(u.id)}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors disabled:opacity-40">
                        <CheckCircle className="w-3 h-3" /> Unban
                      </button>
                    ) : u.id !== me?.id && (
                      <button disabled={actionLoading} onClick={() => banUser(u.id)}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40">
                        <Ban className="w-3 h-3" /> Ban
                      </button>
                    )}
                  </div>

                  {u.active_ban && (
                    <p className="text-xs text-orange-400/80">
                      Banned: {u.active_ban.reason} {u.active_ban.expires_at ? `· expires ${timeAgo(u.active_ban.expires_at)}` : '· permanent'}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Pagination page={page} pages={pages} onPage={setPage} />
    </div>
  );
}

// ─── Streams Tab ───────────────────────────────────────────────────────────────

function StreamsTab() {
  const [streams, setStreams] = useState<AdminStream[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [liveOnly, setLiveOnly] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const flash = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 3000); };

  const load = useCallback(async (pg = page) => {
    setLoading(true);
    try {
      const params: Record<string, string | number | boolean> = { page: pg, limit: 25 };
      if (liveOnly !== null) params.is_live = liveOnly;
      const r = await api.get('/admin/streams', { params });
      setStreams(r.data.streams);
      setTotal(r.data.total);
      setPages(r.data.pages);
    } catch { } finally { setLoading(false); }
  }, [page, liveOnly]);

  useEffect(() => { load(1); setPage(1); }, [liveOnly]); // eslint-disable-line
  useEffect(() => { load(page); }, [page]); // eslint-disable-line

  const forceEnd = async (streamId: string) => {
    if (!confirm('Force-end this stream?')) return;
    try {
      await api.post(`/admin/streams/${streamId}/end`, { reason: 'Ended by admin' });
      flash('Stream ended');
      load(page);
    } catch (e) { flash(getErrorMessage(e), false); }
  };

  return (
    <div className="space-y-4">
      {msg && (
        <div className={cn('px-4 py-2 rounded-lg text-sm', msg.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
          {msg.text}
        </div>
      )}

      <div className="flex items-center gap-2">
        {[null, true, false].map((val) => (
          <button
            key={String(val)}
            onClick={() => setLiveOnly(val)}
            className={cn('text-xs px-3 py-1.5 rounded-lg border transition-colors',
              liveOnly === val ? 'border-rogan-500 bg-rogan-600/20 text-rogan-300' : 'border-white/10 text-white/50 hover:text-white')}
          >
            {val === null ? 'All' : val ? 'Live' : 'Ended'}
          </button>
        ))}
        <span className="ml-auto text-xs text-white/40">{total} streams</span>
      </div>

      {loading ? <LoadingSpinner className="py-12" /> : (
        <div className="space-y-2">
          {streams.length === 0 && <EmptyState icon={Radio} title="No streams found" description="No streams match your filter." />}
          {streams.map((s) => (
            <div key={s.id} className="bg-surface border border-white/5 rounded-xl p-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  {s.is_live && <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded animate-pulse font-bold">LIVE</span>}
                  {s.is_private && <span className="text-xs bg-white/10 text-white/40 px-1.5 py-0.5 rounded">private</span>}
                  <span className="text-white text-sm font-medium truncate">{s.title}</span>
                </div>
                <p className="text-xs text-white/40">
                  @{s.creator_username || 'unknown'}
                  {s.is_live && ` · ${s.viewer_count} viewers`}
                  {s.category && ` · ${s.category}`}
                  {s.created_at && ` · ${timeAgo(s.created_at)}`}
                </p>
              </div>
              {s.is_live && (
                <button onClick={() => forceEnd(s.id)}
                  className="flex-shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
                  <Trash2 className="w-3 h-3" /> End
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Pagination page={page} pages={pages} onPage={setPage} />
    </div>
  );
}

// ─── Reports Tab ───────────────────────────────────────────────────────────────

function ReportsTab() {
  const { user: me } = useAuthStore();
  const isAdmin = me?.role === 'admin';
  const [reports, setReports] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [suspendUserId, setSuspendUserId] = useState<string | null>(null);
  const [suspendDuration, setSuspendDuration] = useState(1440);

  const flash = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 3000); };

  const load = useCallback(async (pg = page) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page: pg, limit: 25 };
      if (statusFilter) params.status = statusFilter;
      const r = await api.get('/moderation/reports', { params });
      setReports(r.data.reports ?? r.data ?? []);
      setTotal(r.data.total ?? 0);
      setPages(r.data.pages ?? 1);
    } catch { } finally { setLoading(false); }
  }, [page, statusFilter]);

  useEffect(() => { load(1); setPage(1); }, [statusFilter]); // eslint-disable-line
  useEffect(() => { load(page); }, [page]); // eslint-disable-line

  const act = async (reportId: string, action: string) => {
    try {
      await api.post(`/moderation/reports/${reportId}/action`, { action, reason: `Mod: ${action}` });
      flash(`Action: ${action}`);
      load(page);
    } catch (e) { flash(getErrorMessage(e), false); }
  };

  const forceStop = async (reportId: string) => {
    if (!confirm('Force-stop this live stream?')) return;
    try {
      await api.post(`/moderation/reports/${reportId}/force-stop`);
      flash('Stream force-stopped');
      load(page);
    } catch (e) { flash(getErrorMessage(e), false); }
  };

  const suspend = async (userId: string, duration: number) => {
    try {
      await api.post(`/moderation/suspend/${userId}`, { reason: 'Suspended by moderation', duration_minutes: duration });
      flash(`User suspended for ${duration < 60 ? duration + 'm' : Math.round(duration / 60) + 'h'}`);
      setSuspendUserId(null);
      load(page);
    } catch (e) { flash(getErrorMessage(e), false); }
  };

  return (
    <div className="space-y-4">
      {msg && (
        <div className={cn('px-4 py-2 rounded-lg text-sm', msg.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
          {msg.text}
        </div>
      )}

      {/* Suspend duration picker modal */}
      {suspendUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-white/10 rounded-2xl p-6 w-80 space-y-4">
            <h3 className="text-white font-semibold">Suspend from Going Live</h3>
            <div className="space-y-2">
              {[
                { label: '1 hour', val: 60 },
                { label: '6 hours', val: 360 },
                { label: '24 hours', val: 1440 },
                { label: '7 days', val: 10080 },
                { label: '30 days', val: 43200 },
                { label: 'Permanent', val: 0 },
              ].map(({ label, val }) => (
                <button
                  key={val}
                  onClick={() => setSuspendDuration(val)}
                  className={cn('w-full text-left text-sm px-4 py-2.5 rounded-lg border transition-colors',
                    suspendDuration === val ? 'border-rogan-500 bg-rogan-600/20 text-rogan-300' : 'border-white/10 text-white/60 hover:border-white/30')}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSuspendUserId(null)} className="flex-1 py-2.5 bg-white/5 text-white/60 rounded-xl text-sm">Cancel</button>
              <button
                onClick={() => suspend(suspendUserId, suspendDuration || 999999)}
                className="flex-1 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-semibold transition-colors"
              >
                Suspend
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {['pending', 'resolved', 'dismissed', ''].map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatusFilter(s)}
            className={cn('text-xs px-3 py-1.5 rounded-lg border transition-colors',
              statusFilter === s ? 'border-rogan-500 bg-rogan-600/20 text-rogan-300' : 'border-white/10 text-white/50 hover:text-white')}
          >
            {s || 'All'}
          </button>
        ))}
        <span className="ml-auto text-xs text-white/40">{total} reports</span>
      </div>

      {loading ? <LoadingSpinner className="py-12" /> : (
        <div className="space-y-2">
          {reports.length === 0 && <EmptyState icon={Flag} title="No reports" description="Nothing here." />}
          {reports.map((r) => (
            <div key={r.id} className="bg-surface border border-white/5 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className={cn('w-4 h-4 mt-0.5 flex-shrink-0', r.priority >= 5 ? 'text-red-400' : r.priority >= 2 ? 'text-amber-400' : 'text-white/30')} />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white text-sm font-medium capitalize">{r.target_type} report</span>
                    <span className={cn('text-xs px-2 py-0.5 rounded',
                      r.status === 'pending' ? 'bg-amber-500/20 text-amber-400' :
                      r.status === 'resolved' ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-white/40')}>
                      {r.status}
                    </span>
                    {r.priority >= 5 && <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">HIGH PRIORITY</span>}
                  </div>
                  <p className="text-sm text-white/70 leading-snug">{r.reason}</p>
                  <div className="flex items-center gap-3 text-xs text-white/30 flex-wrap">
                    <span>by <span className="text-white/50">@{r.reporter_username || r.reporter_id.slice(0, 8)}</span></span>
                    <span>target <span className="text-white/50">@{r.target_username || r.target_id.slice(0, 8)}</span></span>
                    <span>{r.created_at ? timeAgo(r.created_at) : ''}</span>
                  </div>
                </div>
              </div>

              {r.status === 'pending' && (
                <div className="flex gap-2 flex-wrap pt-1">
                  {r.target_type === 'stream' && (
                    <button onClick={() => forceStop(r.id)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-700/20 text-red-300 hover:bg-red-700/40 border border-red-700/30 transition-colors font-medium">
                      <ArrowUpDown className="w-3 h-3" /> Force Stop
                    </button>
                  )}
                  <button onClick={() => act(r.id, 'warn')}
                    className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors">Warn</button>
                  {isAdmin && (
                    <>
                      <button onClick={() => { setSuspendUserId(r.target_id); setSuspendDuration(1440); }}
                        className="text-xs px-3 py-1.5 rounded-lg bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-colors">Suspend</button>
                      <button onClick={() => act(r.id, 'ban')}
                        className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">Ban</button>
                    </>
                  )}
                  <button onClick={() => act(r.id, 'dismiss')}
                    className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 transition-colors ml-auto">Dismiss</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Pagination page={page} pages={pages} onPage={setPage} />
    </div>
  );
}

// ─── Appeals Tab ───────────────────────────────────────────────────────────────

function AppealsTab() {
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const flash = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 3000); };

  const load = useCallback(async (pg = page) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page: pg, limit: 25 };
      if (statusFilter) params.status = statusFilter;
      const r = await api.get('/moderation/appeals', { params });
      setAppeals(r.data.appeals ?? []);
      setTotal(r.data.total ?? 0);
      setPages(r.data.pages ?? 1);
    } catch { } finally { setLoading(false); }
  }, [page, statusFilter]);

  useEffect(() => { load(1); setPage(1); }, [statusFilter]); // eslint-disable-line
  useEffect(() => { load(page); }, [page]); // eslint-disable-line

  const review = async (appealId: string, approved: boolean) => {
    const note = approved ? '' : prompt('Rejection reason (optional):') ?? '';
    try {
      await api.post(`/moderation/appeals/${appealId}/review`, { approved, reviewer_note: note || null });
      flash(approved ? 'Appeal approved — ban lifted' : 'Appeal rejected');
      load(page);
    } catch (e) { flash(getErrorMessage(e), false); }
  };

  return (
    <div className="space-y-4">
      {msg && (
        <div className={cn('px-4 py-2 rounded-lg text-sm', msg.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
          {msg.text}
        </div>
      )}

      <div className="flex items-center gap-2">
        {['pending', 'approved', 'rejected', ''].map((s) => (
          <button key={s || 'all'} onClick={() => setStatusFilter(s)}
            className={cn('text-xs px-3 py-1.5 rounded-lg border transition-colors',
              statusFilter === s ? 'border-rogan-500 bg-rogan-600/20 text-rogan-300' : 'border-white/10 text-white/50 hover:text-white')}>
            {s || 'All'}
          </button>
        ))}
        <span className="ml-auto text-xs text-white/40">{total} appeals</span>
      </div>

      {loading ? <LoadingSpinner className="py-12" /> : (
        <div className="space-y-2">
          {appeals.length === 0 && <EmptyState icon={Shield} title="No appeals" description="Nothing pending." />}
          {appeals.map((a) => (
            <div key={a.id} className="bg-surface border border-white/5 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {(a.username || "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-white text-sm font-medium">@{a.username || a.user_id.slice(0, 8)}</span>
                    <span className={cn("text-xs px-2 py-0.5 rounded",
                      a.status === "pending" ? "bg-amber-500/20 text-amber-400" :
                      a.status === "approved" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400")}>
                      {a.status}
                    </span>
                    <span className="text-xs text-white/30">{a.created_at ? timeAgo(a.created_at) : ""}</span>
                  </div>
                  <p className="text-sm text-white/70 leading-snug">{a.reason}</p>
                  {a.reviewer_note && (
                    <p className="text-xs text-white/40 mt-1 italic">Mod note: {a.reviewer_note}</p>
                  )}
                </div>
              </div>

              {a.status === "pending" && (
                <div className="flex gap-2">
                  <button onClick={() => review(a.id, true)}
                    className="flex-1 py-2 bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded-lg text-xs font-semibold transition-colors">
                    Approve &amp; Lift Ban
                  </button>
                  <button onClick={() => review(a.id, false)}
                    className="flex-1 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg text-xs font-semibold transition-colors">
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Pagination page={page} pages={pages} onPage={setPage} />
    </div>
  );
}

// ─── Transactions Tab ──────────────────────────────────────────────────────────

function TransactionsTab() {
  const [txns, setTxns] = useState<{
    id: string; type: string; amount: number; from_user_id: string | null;
    to_user_id: string | null; created_at: string | null;
  }[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (pg = page) => {
    setLoading(true);
    try {
      const r = await api.get('/admin/transactions', { params: { page: pg, limit: 25 } });
      setTxns(r.data.transactions ?? []);
      setTotal(r.data.total ?? 0);
      setPages(r.data.pages ?? 1);
    } catch { } finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(page); }, [page]); // eslint-disable-line

  const TYPE_COLOR: Record<string, string> = {
    gift_send: 'text-amber-400',
    subscription: 'text-purple-400',
    private_show_entry: 'text-pink-400',
    dm_payment: 'text-blue-400',
    deposit: 'text-green-400',
    withdrawal: 'text-red-400',
    pk_gift: 'text-orange-400',
    marketplace_purchase: 'text-cyan-400',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/40">{total} transactions</span>
        <button onClick={() => load(page)} className="text-xs text-white/40 hover:text-white flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {loading ? <LoadingSpinner className="py-12" /> : (
        <div className="space-y-1.5">
          {txns.length === 0 && <EmptyState icon={Activity} title="No transactions" description="Nothing yet." />}
          {txns.map((t) => (
            <div key={t.id} className="bg-surface border border-white/5 rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn('text-xs font-semibold uppercase tracking-wide', TYPE_COLOR[t.type] ?? 'text-white/50')}>
                    {t.type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-white font-semibold text-sm">{t.amount} TK</span>
                </div>
                <p className="text-xs text-white/30 truncate mt-0.5">
                  {(t as any).from_username || (t.from_user_id ? t.from_user_id.slice(0, 8) : '—')}
                  {' → '}
                  {(t as any).to_username || (t.to_user_id ? t.to_user_id.slice(0, 8) : '—')}
                </p>
              </div>
              <span className="text-xs text-white/20 flex-shrink-0">{t.created_at ? timeAgo(t.created_at) : ''}</span>
            </div>
          ))}
        </div>
      )}

      <Pagination page={page} pages={pages} onPage={setPage} />
    </div>
  );
}



// ─── Economy Tab ───────────────────────────────────────────────────────────────

interface EconomyData {
  economy: { tk_in_circulation: number; total_deposited: number; total_withdrawn: number; total_gifted: number };
  top_earners: { user_id: string; username: string | null; earned: number }[];
  recent_flow: { id: string; type: string; amount: number; user_id: string; username: string | null; created_at: string | null }[];
}

function EconomyTab() {
  const [data, setData] = useState<EconomyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/economy').then((r) => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner className="py-20" />;
  if (!data) return <EmptyState icon={DollarSign} title="Failed to load economy" description="" />;

  const { economy, top_earners, recent_flow } = data;
  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="TK in Circulation" value={formatTK(economy.tk_in_circulation)} icon={Activity} color="bg-cyan-600" />
        <StatCard label="Total Deposited" value={formatTK(economy.total_deposited)} icon={ArrowUpDown} color="bg-green-600" />
        <StatCard label="Total Withdrawn" value={formatTK(economy.total_withdrawn)} icon={ArrowUpDown} color="bg-red-600" />
        <StatCard label="Total Gifted" value={formatTK(economy.total_gifted)} icon={Zap} color="bg-amber-600" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Top Earners */}
        <div className="bg-surface border border-white/5 rounded-xl p-4 space-y-3">
          <h3 className="text-white font-semibold text-sm">Top Earners</h3>
          <div className="space-y-2">
            {top_earners.map((e, i) => (
              <div key={e.user_id} className="flex items-center gap-3">
                <span className="text-white/30 text-xs w-5 text-right">{i + 1}</span>
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {(e.username || '?').charAt(0).toUpperCase()}
                </div>
                <span className="text-white text-sm flex-1 min-w-0 truncate">@{e.username ?? e.user_id.slice(0, 8)}</span>
                <span className="text-amber-400 text-xs font-semibold flex-shrink-0">{formatTK(e.earned)} TK</span>
              </div>
            ))}
            {top_earners.length === 0 && <p className="text-white/30 text-xs text-center py-4">No data yet</p>}
          </div>
        </div>

        {/* Recent Flow */}
        <div className="bg-surface border border-white/5 rounded-xl p-4 space-y-3">
          <h3 className="text-white font-semibold text-sm">Recent Deposits & Withdrawals</h3>
          <div className="space-y-2">
            {recent_flow.map((t) => (
              <div key={t.id} className="flex items-center gap-3">
                <span className={cn('text-xs font-semibold w-16 flex-shrink-0', t.type === 'deposit' ? 'text-green-400' : 'text-red-400')}>
                  {t.type}
                </span>
                <span className="text-white text-xs flex-1 min-w-0 truncate">@{t.username ?? t.user_id.slice(0, 8)}</span>
                <span className="text-white/60 text-xs flex-shrink-0">{t.amount} TK</span>
                <span className="text-white/20 text-xs flex-shrink-0">{t.created_at ? timeAgo(t.created_at) : ''}</span>
              </div>
            ))}
            {recent_flow.length === 0 && <p className="text-white/30 text-xs text-center py-4">No flow yet</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Creators Tab ──────────────────────────────────────────────────────────────

interface CreatorRow {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  is_live: boolean;
  earned_tk: number;
  stream_count: number;
}

function CreatorsTab() {
  const [creators, setCreators] = useState<CreatorRow[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const r = await api.get('/admin/creators', { params: { page: pg, limit: 25 } });
      setCreators(r.data.creators ?? []);
      setHasMore((r.data.creators ?? []).length === 25);
    } catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(page); }, [page]); // eslint-disable-line

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/40">Creator leaderboard by TK earned</span>
        <button onClick={() => load(page)} className="text-xs text-white/40 hover:text-white flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {loading ? <LoadingSpinner className="py-12" /> : (
        <div className="space-y-2">
          {creators.length === 0 && <EmptyState icon={Crown} title="No creators yet" description="Nobody has earned TK yet." />}
          {creators.map((c, i) => (
            <div key={c.user_id} className="bg-surface border border-white/5 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-white/20 text-sm font-bold w-6 text-right flex-shrink-0">
                {(page - 1) * 25 + i + 1}
              </span>
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {(c.display_name || c.username || '?').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm font-medium">@{c.username}</span>
                  {c.is_live && <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded font-semibold animate-pulse">LIVE</span>}
                </div>
                <p className="text-xs text-white/30">{c.stream_count} streams</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-amber-400 font-semibold text-sm">{formatTK(c.earned_tk)} TK</p>
                <p className="text-white/20 text-[10px]">earned</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-center gap-2 pt-2">
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
          className="px-3 py-1.5 text-xs text-white/40 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg disabled:opacity-30 transition-colors">
          ← Prev
        </button>
        <span className="text-xs text-white/30 self-center">Page {page}</span>
        <button disabled={!hasMore} onClick={() => setPage((p) => p + 1)}
          className="px-3 py-1.5 text-xs text-white/40 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg disabled:opacity-30 transition-colors">
          Next →
        </button>
      </div>
    </div>
  );
}

// ─── Settings Tab ──────────────────────────────────────────────────────────────

interface PlatformConfig {
  platform_fee_phase1: number;
  platform_fee_phase2: number;
  platform_fee_phase3: number;
  withdraw_fee: number;
  tk_to_rogan_rate: number;
  max_streams_per_creator: number;
  gift_rate_limit_per_sec: number;
  dm_rate_limit_per_sec: number;
  live_streaming_enabled: boolean;
  gifts_enabled: boolean;
  private_shows_enabled: boolean;
  pk_battles_enabled: boolean;
}


// ─── WithdrawalsTab ─────────────────────────────────────────────────────────
function WithdrawalsTab() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [completeTx, setCompleteTx] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const res = await api.get('/wallet/admin/withdrawals', { params });
      setItems(res.data.items);
      setTotal(res.data.total);
    } catch (e) { setErr(getErrorMessage(e)); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const approve = async (id: string) => {
    setProcessing(id);
    try {
      await api.post(`/wallet/admin/withdrawals/${id}/approve`);
      await load();
    } catch (e) { setErr(getErrorMessage(e)); }
    finally { setProcessing(null); }
  };

  const complete = async (id: string) => {
    const txHash = completeTx[id];
    if (!txHash?.trim()) return;
    setProcessing(id);
    try {
      await api.post(`/wallet/admin/withdrawals/${id}/complete`, { tx_hash: txHash });
      setCompleteTx((p) => { const n = { ...p }; delete n[id]; return n; });
      await load();
    } catch (e) { setErr(getErrorMessage(e)); }
    finally { setProcessing(null); }
  };

  const reject = async (id: string) => {
    const reason = rejectReason[id];
    if (!reason?.trim()) return;
    setProcessing(id);
    try {
      await api.post(`/wallet/admin/withdrawals/${id}/reject`, { reason });
      setRejectReason((p) => { const n = { ...p }; delete n[id]; return n; });
      await load();
    } catch (e) { setErr(getErrorMessage(e)); }
    finally { setProcessing(null); }
  };

  const STATUS_COLORS: Record<string, string> = {
    pending: 'bg-amber-500/15 text-amber-400',
    approved: 'bg-blue-500/15 text-blue-400',
    completed: 'bg-green-500/15 text-green-400',
    rejected: 'bg-red-500/15 text-red-400',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold">Withdrawals ({total})</h2>
        <div className="flex gap-2">
          {['', 'pending', 'approved', 'completed', 'rejected'].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn('px-3 py-1 rounded-lg text-xs transition-colors',
                statusFilter === s ? 'bg-rogan-600/40 text-rogan-300' : 'bg-white/5 text-white/40 hover:text-white/70'
              )}
            >
              {s || 'All'}
            </button>
          ))}
          <button onClick={load} className="p-1.5 bg-white/5 rounded-lg text-white/40 hover:text-white/70">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {err && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm flex justify-between">
          {err} <button onClick={() => setErr(null)} className="text-red-400/50 hover:text-red-400">×</button>
        </div>
      )}

      {loading ? <LoadingSpinner className="py-12" /> : items.length === 0 ? (
        <div className="text-center py-12 text-white/30 text-sm">No withdrawal requests</div>
      ) : (
        <div className="space-y-3">
          {items.map((w) => (
            <div key={w.id} className="bg-surface rounded-xl p-4 border border-white/5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-white font-medium text-sm">@{w.username}</p>
                  <p className="text-white/50 text-xs font-mono break-all">{w.wallet_address}</p>
                  <p className="text-white/30 text-[11px]">
                    Requested {w.requested_at ? timeAgo(w.requested_at) : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-white font-bold">{formatTK(w.amount_tk)} TK</p>
                  {w.amount_rogan && (
                    <p className="text-white/40 text-xs">{w.amount_rogan.toLocaleString()} ROGAN</p>
                  )}
                  {w.rogan_price_usd && (
                    <p className="text-white/25 text-[10px]">${w.rogan_price_usd.toFixed(8)}/ROGAN</p>
                  )}
                  <span className={cn('inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase', STATUS_COLORS[w.status] ?? 'bg-white/10 text-white/50')}>
                    {w.status}
                  </span>
                </div>
              </div>

              {w.tx_hash && (
                <a href={`https://basescan.org/tx/${w.tx_hash}`} target="_blank" rel="noreferrer"
                  className="text-white/30 text-xs flex items-center gap-1 hover:text-white/60">
                  Tx: {w.tx_hash.slice(0, 16)}...
                </a>
              )}
              {w.rejection_reason && (
                <p className="text-red-400/60 text-xs">Rejected: {w.rejection_reason}</p>
              )}

              {/* Actions */}
              {w.status === 'pending' && (
                <div className="flex gap-2 pt-1">
                  <button onClick={() => approve(w.id)} disabled={processing === w.id}
                    className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg text-xs font-medium disabled:opacity-50">
                    Approve
                  </button>
                  <div className="flex-1 flex gap-1.5">
                    <input
                      placeholder="Rejection reason"
                      value={rejectReason[w.id] ?? ''}
                      onChange={(e) => setRejectReason((p) => ({ ...p, [w.id]: e.target.value }))}
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/20 focus:outline-none"
                    />
                    <button onClick={() => reject(w.id)} disabled={processing === w.id || !rejectReason[w.id]?.trim()}
                      className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-xs font-medium disabled:opacity-40">
                      Reject
                    </button>
                  </div>
                </div>
              )}

              {w.status === 'approved' && (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 space-y-2">
                  <p className="text-blue-300 text-xs font-medium">
                    Send {w.amount_rogan?.toLocaleString() ?? '?'} ROGAN to {w.wallet_address.slice(0,10)}...{w.wallet_address.slice(-6)}
                  </p>
                  <div className="flex gap-2">
                    <input
                      placeholder="Outgoing tx hash (0x...)"
                      value={completeTx[w.id] ?? ''}
                      onChange={(e) => setCompleteTx((p) => ({ ...p, [w.id]: e.target.value }))}
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-mono placeholder:text-white/20 focus:outline-none"
                    />
                    <button onClick={() => complete(w.id)} disabled={processing === w.id || !completeTx[w.id]?.trim()}
                      className="px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg text-xs font-medium disabled:opacity-40">
                      Mark Complete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsTab() {
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);

  const [roganPrice, setRoganPrice] = useState<number | null>(null);
  const [roganPriceInput, setRoganPriceInput] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);

  useEffect(() => {
    api.get('/admin/platform/config').then((r) => setConfig(r.data)).catch(() => {});
    api.get('/wallet/admin/rogan-price').then((r) => {
      setRoganPrice(r.data.price_usd);
      setRoganPriceInput(String(r.data.price_usd));
    }).catch(() => {});
  }, []);

  const flash = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 3000); };

  const saveRoganPrice = async () => {
    const p = parseFloat(roganPriceInput);
    if (!p || p <= 0) return;
    setSavingPrice(true);
    try {
      const r = await api.post('/wallet/admin/rogan-price', { price_usd: p });
      setRoganPrice(r.data.price_usd);
      flash('ROGAN price updated');
    } catch (e) { flash(getErrorMessage(e), false); }
    finally { setSavingPrice(false); }
  };

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const r = await api.patch('/admin/platform/config', config);
      setConfig(r.data);
      flash('Config saved');
    } catch (e) { flash(getErrorMessage(e), false); }
    finally { setSaving(false); }
  };

  const broadcast = async () => {
    if (!broadcastTitle.trim() || !broadcastMsg.trim()) return;
    setBroadcasting(true);
    try {
      const r = await api.post('/admin/notifications/broadcast', { title: broadcastTitle, message: broadcastMsg, type: 'announcement' });
      flash(`Sent to ${r.data.sent} users`);
      setBroadcastTitle(''); setBroadcastMsg('');
    } catch (e) { flash(getErrorMessage(e), false); }
    finally { setBroadcasting(false); }
  };

  const set = <K extends keyof PlatformConfig>(key: K, val: PlatformConfig[K]) =>
    setConfig((c) => c ? { ...c, [key]: val } : c);

  return (
    <div className="space-y-6">
      {msg && (
        <div className={cn('px-4 py-2.5 rounded-xl text-sm', msg.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
          {msg.text}
        </div>
      )}

      {/* Feature Flags */}
      <div className="bg-surface border border-white/5 rounded-xl p-5 space-y-4">
        <h3 className="text-white font-semibold">Feature Flags</h3>
        {config && ([
          { key: 'live_streaming_enabled' as const, label: 'Live Streaming' },
          { key: 'gifts_enabled' as const, label: 'Gifts' },
          { key: 'private_shows_enabled' as const, label: 'Private Shows' },
          { key: 'pk_battles_enabled' as const, label: 'PK Battles' },
        ]).map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between">
            <span className="text-white/70 text-sm">{label}</span>
            <button
              onClick={() => set(key, !config[key])}
              className={cn('relative w-11 h-6 rounded-full transition-colors', config[key] ? 'bg-rogan-600' : 'bg-white/10')}
            >
              <span className={cn('absolute top-1 w-4 h-4 rounded-full bg-white transition-all', config[key] ? 'left-6' : 'left-1')} />
            </button>
          </div>
        ))}
      </div>

      {/* Fee Config */}
      {config && (
        <div className="bg-surface border border-white/5 rounded-xl p-5 space-y-4">
          <h3 className="text-white font-semibold">Fee Configuration</h3>
          <div className="grid grid-cols-2 gap-4">
            {([
              { key: 'platform_fee_phase1' as const, label: 'Platform Fee P1 (%)', scale: 100 },
              { key: 'platform_fee_phase2' as const, label: 'Platform Fee P2 (%)', scale: 100 },
              { key: 'platform_fee_phase3' as const, label: 'Platform Fee P3 (%)', scale: 100 },
              { key: 'withdraw_fee' as const, label: 'Withdrawal Fee (%)', scale: 100 },
            ]).map(({ key, label, scale }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-xs text-white/50">{label}</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  value={Math.round(config[key] * scale)}
                  onChange={(e) => set(key, Number(e.target.value) / scale)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-rogan-500/50"
                />
              </div>
            ))}
            {([
              { key: 'tk_to_rogan_rate' as const, label: 'TK → ROGAN Rate', scale: 1 },
              { key: 'max_streams_per_creator' as const, label: 'Max Streams / Creator', scale: 1 },
              { key: 'gift_rate_limit_per_sec' as const, label: 'Gift Rate Limit (/ sec)', scale: 1 },
              { key: 'dm_rate_limit_per_sec' as const, label: 'DM Rate Limit (/ sec)', scale: 1 },
            ]).map(({ key, label, scale }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-xs text-white/50">{label}</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={config[key]}
                  onChange={(e) => set(key, Number(e.target.value) / scale)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-rogan-500/50"
                />
              </div>
            ))}
          </div>
          <button
            onClick={saveConfig}
            disabled={saving}
            className="w-full py-2.5 bg-rogan-600 hover:bg-rogan-700 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            {saving ? 'Saving…' : 'Save Configuration'}
          </button>
        </div>
      )}

      {/* ROGAN Price */}
      <div className="bg-surface border border-white/5 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-white font-semibold">ROGAN Price</h3>
          <p className="text-white/40 text-xs mt-1">
            Set the current ROGAN/USD price. Used for deposit valuation and TK conversion.
            {roganPrice !== null && <span className="text-white/60 ml-1">Current: ${roganPrice.toFixed(10)}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            step="any"
            min="0"
            placeholder="e.g. 0.0000009"
            value={roganPriceInput}
            onChange={(e) => setRoganPriceInput(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 font-mono"
          />
          <button
            onClick={saveRoganPrice}
            disabled={savingPrice || !roganPriceInput || parseFloat(roganPriceInput) <= 0}
            className="px-4 py-2.5 bg-rogan-600 hover:bg-rogan-700 disabled:opacity-40 text-white rounded-lg text-sm font-semibold transition-colors whitespace-nowrap"
          >
            {savingPrice ? 'Saving…' : 'Set Price'}
          </button>
        </div>
        {roganPrice !== null && (
          <p className="text-white/30 text-xs">
            1 TK = {Math.round(0.1 / roganPrice).toLocaleString()} ROGAN &nbsp;·&nbsp; 1M ROGAN = ${(roganPrice * 1_000_000).toFixed(4)} USD
          </p>
        )}
      </div>

      {/* Broadcast */}
      <div className="bg-surface border border-white/5 rounded-xl p-5 space-y-4">
        <h3 className="text-white font-semibold">Broadcast Notification</h3>
        <p className="text-white/40 text-xs">Send a notification to all active users on the platform.</p>
        <input
          type="text"
          placeholder="Title"
          value={broadcastTitle}
          onChange={(e) => setBroadcastTitle(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50"
        />
        <textarea
          placeholder="Message…"
          value={broadcastMsg}
          onChange={(e) => setBroadcastMsg(e.target.value)}
          rows={3}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 resize-none"
        />
        <button
          onClick={broadcast}
          disabled={broadcasting || !broadcastTitle.trim() || !broadcastMsg.trim()}
          className="w-full py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition-colors"
        >
          {broadcasting ? 'Sending…' : '📢 Broadcast to All Users'}
        </button>
      </div>
    </div>
  );
}


export default function AdminView() {
  const { user: me } = useAuthStore();
  const isAdmin = me?.role === 'admin';
  const [tab, setTab] = useState<Tab>('reports');

  const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; adminOnly?: boolean }[] = [
    { id: 'overview',      label: 'Overview',      icon: BarChart2,      adminOnly: true },
    { id: 'users',         label: 'Users',          icon: Users,          adminOnly: true },
    { id: 'streams',       label: 'Streams',        icon: Radio,          adminOnly: false },
    { id: 'reports',       label: 'Reports',        icon: Flag,           adminOnly: false },
    { id: 'appeals',       label: 'Appeals',        icon: AlertTriangle,  adminOnly: false },
    { id: 'transactions',  label: 'Transactions',   icon: Activity,       adminOnly: true },
    { id: 'economy',       label: 'Economy',        icon: DollarSign,     adminOnly: true },
    { id: 'creators',      label: 'Creators',       icon: Crown,          adminOnly: true },
    { id: 'withdrawals',   label: 'Withdrawals',    icon: Activity,       adminOnly: true },
    { id: 'settings',      label: 'Settings',       icon: ArrowUpDown,    adminOnly: true },
  ].filter((t) => !t.adminOnly || isAdmin) as { id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; adminOnly?: boolean }[];

  const effectiveTab = (!isAdmin && !["reports", "appeals", "streams"].includes(tab)) ? "reports" : tab;

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-8 h-8 rounded-lg bg-rogan-600 flex items-center justify-center">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg leading-none">Admin Panel</h1>
            <p className="text-white/40 text-xs">Rogan Live Management</p>
          </div>
        </div>
        <div className="flex gap-1 px-4 pb-3 overflow-x-auto scrollbar-none">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                effectiveTab === t.id
                  ? 'bg-rogan-600 text-white'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/5'
              )}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 max-w-5xl mx-auto">
        {effectiveTab === "overview"      && <OverviewTab />}
        {effectiveTab === "users"         && <UsersTab />}
        {effectiveTab === "streams"       && <StreamsTab />}
        {effectiveTab === "reports"       && <ReportsTab />}
        {effectiveTab === "appeals"       && <AppealsTab />}
        {effectiveTab === "transactions"  && <TransactionsTab />}
        {effectiveTab === "economy"       && <EconomyTab />}
        {effectiveTab === "creators"      && <CreatorsTab />}
        {effectiveTab === "withdrawals"   && <WithdrawalsTab />}
        {effectiveTab === "settings"      && <SettingsTab />}
      </div>
    </div>
  );
}
