'use client';

/**
 * Rogan Live — Task Marketplace
 * Browse tasks, post tasks, bid, accept, complete, dispute.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Briefcase, Plus, ChevronRight, Clock, Coins, User,
  Check, X, AlertCircle, ArrowLeft, Send, Flag,
} from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useWalletStore } from '@/stores/walletStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn, formatTK, timeAgo } from '@/lib/utils';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import EmptyState from '@/components/shared/EmptyState';

interface Task {
  id: string;
  creator_id: string;
  creator?: { id: string; username: string; display_name: string | null; avatar: string | null } | null;
  title: string;
  description: string | null;
  category: string | null;
  price_tk: number;
  deadline: string | null;
  status: 'open' | 'bidding' | 'in_progress' | 'completed' | 'disputed';
  bid_count: number;
  created_at: string | null;
}

interface Bid {
  id: string;
  task_id: string;
  bidder_id: string;
  bidder?: { id: string; username: string; display_name: string | null } | null;
  amount_tk: number;
  message: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  created_at: string | null;
}

const CATEGORIES = ['All', 'Video Call', 'Custom Video', 'Shoutout', 'Coaching', 'Design', 'Music', 'Other'];
const STATUS_COLORS: Record<string, string> = {
  open: 'bg-green-600/20 text-green-400',
  bidding: 'bg-blue-600/20 text-blue-400',
  in_progress: 'bg-amber-600/20 text-amber-400',
  completed: 'bg-white/10 text-white/40',
  disputed: 'bg-red-600/20 text-red-400',
};

export default function TaskMarketplace() {
  const { user } = useAuthStore();
  const { wallet, fetchWallet } = useWalletStore();
  const isMobile = useIsMobile(960);
  const [tab, setTab] = useState<'browse' | 'my-tasks' | 'post'>('browse');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskBids, setTaskBids] = useState<Bid[]>([]);
  const [category, setCategory] = useState('All');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Post form
  const [postTitle, setPostTitle] = useState('');
  const [postDesc, setPostDesc] = useState('');
  const [postCategory, setPostCategory] = useState('');
  const [postPrice, setPostPrice] = useState('');
  const [posting, setPosting] = useState(false);

  // Bid form
  const [bidAmount, setBidAmount] = useState('');
  const [bidMessage, setBidMessage] = useState('');
  const [bidding, setBidding] = useState(false);

  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: Record<string, string> = {};
      if (category !== 'All') params.category = category;
      const res = await api.get('/tasks', { params: { ...params, limit: 30 } });
      setTasks(res.data.tasks || []);
    } catch { setTasks([]); }
    finally { setIsLoading(false); }
  }, [category]);

  const loadMyTasks = useCallback(async () => {
    try {
      const res = await api.get('/tasks', { params: { creator_id: user?.id, limit: 30 } });
      setMyTasks(res.data.tasks || []);
    } catch { setMyTasks([]); }
  }, [user?.id]);

  const loadTaskBids = useCallback(async (taskId: string) => {
    try {
      const res = await api.get(`/tasks/${taskId}`);
      setTaskBids(res.data.bids || []);
    } catch { setTaskBids([]); }
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);
  useEffect(() => { if (tab === 'my-tasks') loadMyTasks(); }, [tab, loadMyTasks]);
  useEffect(() => { fetchWallet(); }, [fetchWallet]);

  const openTask = async (task: Task) => {
    setSelectedTask(task);
    await loadTaskBids(task.id);
  };

  const handlePost = async () => {
    if (!postTitle.trim() || !postPrice) return;
    setPosting(true); setError('');
    try {
      await api.post('/tasks', {
        title: postTitle,
        description: postDesc || undefined,
        category: postCategory || undefined,
        price_tk: parseFloat(postPrice),
      });
      setPostTitle(''); setPostDesc(''); setPostCategory(''); setPostPrice('');
      setTab('my-tasks');
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setPosting(false); }
  };

  const handleBid = async () => {
    if (!selectedTask || !bidAmount) return;
    setBidding(true); setError('');
    try {
      await api.post(`/tasks/${selectedTask.id}/bid`, {
        amount_tk: parseFloat(bidAmount),
        message: bidMessage || undefined,
      });
      setBidAmount(''); setBidMessage('');
      await loadTaskBids(selectedTask.id);
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setBidding(false); }
  };

  const handleAcceptBid = async (bidId: string) => {
    if (!selectedTask) return;
    try {
      await api.post(`/tasks/${selectedTask.id}/accept/${bidId}`);
      await loadTaskBids(selectedTask.id);
      const res = await api.get('/tasks', { params: { limit: 30 } });
      setTasks(res.data.tasks || []);
    } catch (err) { setError(getErrorMessage(err)); }
  };

  const handleComplete = async () => {
    if (!selectedTask) return;
    try {
      await api.post(`/tasks/${selectedTask.id}/complete`);
      setSelectedTask((t) => t ? { ...t, status: 'completed' } : null);
    } catch (err) { setError(getErrorMessage(err)); }
  };

  const handleDispute = async () => {
    if (!selectedTask) return;
    const reason = prompt('Describe the dispute:');
    if (!reason) return;
    try {
      await api.post(`/tasks/${selectedTask.id}/dispute`, { reason });
      setSelectedTask((t) => t ? { ...t, status: 'disputed' } : null);
    } catch (err) { setError(getErrorMessage(err)); }
  };

  // ── Task Detail View ────────────────────────────────────────────────────────
  if (selectedTask) {
    const isOwner = selectedTask.creator_id === user?.id;
    const myBid = taskBids.find((b) => b.bidder_id === user?.id);
    const canBid = !isOwner && selectedTask.status === 'open' && !myBid;

    return (
      <div className={cn('h-full overflow-y-auto scrollbar-thin', isMobile ? 'p-4 pb-24' : 'p-6')}>
        <div className="max-w-2xl mx-auto space-y-5">
          <button onClick={() => setSelectedTask(null)} className="flex items-center gap-2 text-white/50 hover:text-white text-sm transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Tasks
          </button>

          {/* Task card */}
          <div className="bg-surface rounded-xl border border-white/5 p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <h2 className="text-white font-bold text-lg">{selectedTask.title}</h2>
                {selectedTask.description && <p className="text-white/60 text-sm mt-1">{selectedTask.description}</p>}
              </div>
              <span className={cn('text-xs px-2 py-1 rounded-full font-medium flex-shrink-0', STATUS_COLORS[selectedTask.status] || STATUS_COLORS.open)}>
                {selectedTask.status.replace('_', ' ')}
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm text-white/40">
              <span className="flex items-center gap-1"><Coins className="w-3.5 h-3.5 text-tk" /> <span className="text-tk font-medium">{formatTK(selectedTask.price_tk)}</span></span>
              {selectedTask.category && <span className="flex items-center gap-1 bg-white/5 px-2 py-0.5 rounded text-white/50 text-xs">{selectedTask.category}</span>}
              {selectedTask.deadline && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Due {new Date(selectedTask.deadline).toLocaleDateString()}</span>}
            </div>
            {isOwner && selectedTask.status === 'in_progress' && (
              <div className="flex gap-2">
                <button onClick={handleComplete} className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2">
                  <Check className="w-4 h-4" /> Mark Complete
                </button>
                <button onClick={handleDispute} className="px-4 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-lg text-sm flex items-center gap-2 border border-red-900/30">
                  <Flag className="w-4 h-4" /> Dispute
                </button>
              </div>
            )}
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          {/* Bids */}
          <div className="bg-surface rounded-xl border border-white/5">
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-white font-semibold">Bids ({taskBids.length})</h3>
            </div>
            {taskBids.length === 0 ? (
              <p className="text-white/30 text-sm text-center py-6">No bids yet</p>
            ) : (
              <div className="divide-y divide-white/5">
                {taskBids.map((bid) => (
                  <div key={bid.id} className={cn('p-4 flex items-start gap-3', bid.status === 'accepted' && 'bg-green-900/10')}>
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {(bid.bidder?.username || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white text-sm font-medium">{bid.bidder?.display_name || bid.bidder?.username || 'User'}</span>
                        <span className="text-tk text-xs font-medium">{formatTK(bid.amount_tk)}</span>
                        {bid.status === 'accepted' && <span className="text-green-400 text-xs bg-green-900/30 px-1.5 py-0.5 rounded">Accepted</span>}
                      </div>
                      {bid.message && <p className="text-white/50 text-xs">{bid.message}</p>}
                      <p className="text-white/25 text-[10px] mt-1">{bid.created_at ? timeAgo(bid.created_at) : ''}</p>
                    </div>
                    {isOwner && bid.status === 'pending' && selectedTask.status === 'open' && (
                      <button
                        onClick={() => handleAcceptBid(bid.id)}
                        className="px-3 py-1.5 bg-rogan-600 hover:bg-rogan-700 text-white text-xs rounded-lg flex items-center gap-1 flex-shrink-0"
                      >
                        <Check className="w-3 h-3" /> Accept
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Place bid form */}
          {canBid && (
            <div className="bg-surface rounded-xl border border-white/5 p-4 space-y-3">
              <h3 className="text-white font-semibold">Place a Bid</h3>
              <p className="text-white/30 text-xs">Budget: {formatTK(selectedTask.price_tk)} · Your balance: {formatTK(wallet?.tk_balance ?? 0)}</p>
              <input
                type="number"
                placeholder={`Bid amount (max ${selectedTask.price_tk} TK)`}
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-rogan-500/50"
              />
              <textarea
                placeholder="Describe what you'll deliver..."
                value={bidMessage}
                onChange={(e) => setBidMessage(e.target.value)}
                rows={2}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm resize-none focus:outline-none focus:border-rogan-500/50"
              />
              <button
                onClick={handleBid}
                disabled={bidding || !bidAmount}
                className="w-full py-2.5 bg-rogan-600 hover:bg-rogan-700 text-white rounded-lg font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" /> {bidding ? 'Placing Bid...' : 'Place Bid'}
              </button>
            </div>
          )}

          {myBid && (
            <div className="bg-green-900/10 border border-green-900/30 rounded-xl p-4 text-sm text-green-400">
              You&apos;ve placed a bid of {formatTK(myBid.amount_tk)} · Status: {myBid.status}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Main View ───────────────────────────────────────────────────────────────
  return (
    <div className={cn('h-full overflow-y-auto scrollbar-thin', isMobile ? 'p-4 pb-24' : 'p-6')}>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-rogan-500" /> Task Marketplace
          </h2>
          <button
            onClick={() => setTab('post')}
            className="px-4 py-2 bg-rogan-600 hover:bg-rogan-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" /> Post Task
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-surface rounded-xl p-1 border border-white/5 w-fit">
          {(['browse', 'my-tasks', 'post'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-colors', tab === t ? 'bg-rogan-600 text-white' : 'text-white/50 hover:text-white')}
            >
              {t === 'browse' ? 'Browse' : t === 'my-tasks' ? 'My Tasks' : 'Post Task'}
            </button>
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/20 rounded-lg px-4 py-3 border border-red-900/30">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            <button onClick={() => setError('')} className="ml-auto"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Browse tab */}
        {tab === 'browse' && (
          <div className="space-y-4">
            {/* Category filter */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={cn('px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0', category === cat ? 'bg-rogan-600 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white')}
                >
                  {cat}
                </button>
              ))}
            </div>
            {isLoading ? <LoadingSpinner /> : tasks.length === 0 ? (
              <EmptyState icon={Briefcase} title="No tasks yet" description="Be the first to post a task or check back later" />
            ) : (
              <div className="grid gap-3">
                {tasks.map((task) => <TaskCard key={task.id} task={task} onClick={() => openTask(task)} />)}
              </div>
            )}
          </div>
        )}

        {/* My tasks tab */}
        {tab === 'my-tasks' && (
          <div className="space-y-3">
            {myTasks.length === 0 ? (
              <EmptyState icon={Briefcase} title="No tasks posted" description="Post a task to get bids from the community" />
            ) : (
              myTasks.map((task) => <TaskCard key={task.id} task={task} onClick={() => openTask(task)} isOwner />)
            )}
          </div>
        )}

        {/* Post task tab */}
        {tab === 'post' && (
          <div className="bg-surface rounded-xl border border-white/5 p-5 space-y-4 max-w-xl">
            <h3 className="text-white font-semibold">Post a New Task</h3>
            <input
              type="text"
              placeholder="Task title *"
              value={postTitle}
              onChange={(e) => setPostTitle(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-rogan-500/50"
            />
            <textarea
              placeholder="Describe what you need..."
              value={postDesc}
              onChange={(e) => setPostDesc(e.target.value)}
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm resize-none focus:outline-none focus:border-rogan-500/50"
            />
            <div className="grid grid-cols-2 gap-3">
              <select
                value={postCategory}
                onChange={(e) => setPostCategory(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-rogan-500/50"
              >
                <option value="">Category</option>
                {CATEGORIES.slice(1).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input
                type="number"
                placeholder="Budget (TK) *"
                value={postPrice}
                onChange={(e) => setPostPrice(e.target.value)}
                min="1"
                className="bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-rogan-500/50"
              />
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              onClick={handlePost}
              disabled={posting || !postTitle.trim() || !postPrice}
              className="w-full py-3 bg-rogan-600 hover:bg-rogan-700 text-white rounded-lg font-semibold text-sm disabled:opacity-50"
            >
              {posting ? 'Posting...' : 'Post Task'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, onClick, isOwner }: { task: Task; onClick: () => void; isOwner?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="w-full bg-surface rounded-xl border border-white/5 hover:border-rogan-500/20 p-4 text-left transition-colors flex items-start gap-4"
    >
      <div className="w-10 h-10 rounded-xl bg-rogan-600/20 flex items-center justify-center flex-shrink-0">
        <Briefcase className="w-5 h-5 text-rogan-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <p className="text-white font-medium text-sm truncate">{task.title}</p>
          {task.category && <span className="bg-white/5 text-white/40 text-[10px] px-1.5 py-0.5 rounded flex-shrink-0">{task.category}</span>}
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0', STATUS_COLORS[task.status] || STATUS_COLORS.open)}>
            {task.status.replace('_', ' ')}
          </span>
        </div>
        {task.description && <p className="text-white/40 text-xs truncate">{task.description}</p>}
        <div className="flex items-center gap-3 mt-2 text-xs text-white/30">
          <span className="flex items-center gap-1 text-tk"><Coins className="w-3 h-3" /> {formatTK(task.price_tk)}</span>
          <span>{task.bid_count} bid{task.bid_count !== 1 ? 's' : ''}</span>
          {task.created_at && <span>{timeAgo(task.created_at)}</span>}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-white/20 flex-shrink-0 mt-1" />
    </button>
  );
}
