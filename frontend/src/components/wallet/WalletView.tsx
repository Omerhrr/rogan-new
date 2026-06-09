'use client';

import { useState, useEffect } from 'react';
import { Wallet, ArrowDownCircle, ArrowUpCircle, Link2, History, ChevronRight } from 'lucide-react';
import { useWalletStore } from '@/stores/walletStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatTK, cn, timeAgo } from '@/lib/utils';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import type { Transaction } from '@/types';

export default function WalletView() {
  const { wallet, transactions, fetchWallet, fetchTransactions, deposit, withdraw, linkWallet, isLoading, error, clearError } = useWalletStore();
  const isMobile = useIsMobile(960);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [amount, setAmount] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [txPage, setTxPage] = useState(1);

  useEffect(() => {
    fetchWallet();
    fetchTransactions(1);
  }, [fetchWallet, fetchTransactions]);

  const handleDeposit = async () => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return;
    await deposit({ amount: amt });
    setShowDeposit(false);
    setAmount('');
  };

  const handleWithdraw = async () => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return;
    await withdraw({ tk_amount: amt });
    setShowWithdraw(false);
    setAmount('');
  };

  const handleLink = async () => {
    if (!walletAddress.trim()) return;
    await linkWallet({ wallet_address: walletAddress });
    setShowLink(false);
    setWalletAddress('');
  };

  const loadMoreTx = () => {
    const nextPage = txPage + 1;
    setTxPage(nextPage);
    fetchTransactions(nextPage);
  };

  if (!wallet && isLoading) return <LoadingSpinner className="h-full" />;

  return (
    <div className={cn('h-full overflow-y-auto scrollbar-thin', isMobile ? 'p-4 pb-24' : 'p-6')}>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Balance Card */}
        <div className="bg-gradient-to-br from-rogan-600/30 via-purple-600/20 to-blue-600/30 rounded-2xl p-6 border border-white/10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-tk" />
              <span className="text-white/60 text-sm">TK Balance</span>
            </div>
            <span className="text-white/30 text-xs">1 TK = 1 ROGAN</span>
          </div>
          <div className="flex items-baseline gap-2 mb-6">
            <span className="text-4xl font-bold text-white">{formatTK(wallet?.tk_balance || 0)}</span>
            <span className="text-tk text-lg font-medium">TK</span>
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setShowDeposit(true); setShowWithdraw(false); }} className="flex-1 py-2.5 bg-tk/20 hover:bg-tk/30 text-tk font-medium rounded-lg flex items-center justify-center gap-2 text-sm transition-colors">
              <ArrowDownCircle className="w-4 h-4" /> Deposit
            </button>
            <button onClick={() => { setShowWithdraw(true); setShowDeposit(false); }} className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-white/70 font-medium rounded-lg flex items-center justify-center gap-2 text-sm transition-colors">
              <ArrowUpCircle className="w-4 h-4" /> Withdraw
            </button>
            <button onClick={() => setShowLink(!showLink)} className="py-2.5 px-4 bg-white/5 hover:bg-white/10 text-white/70 rounded-lg flex items-center gap-2 text-sm transition-colors">
              <Link2 className="w-4 h-4" /> Link
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm flex items-center justify-between">
            {error}
            <button onClick={clearError} className="text-red-400/60 hover:text-red-400">×</button>
          </div>
        )}

        {/* Deposit Form */}
        {showDeposit && (
          <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-3">
            <h3 className="text-white font-semibold">Deposit ROGAN → TK</h3>
            <input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50" />
            <div className="flex gap-2">
              <button onClick={handleDeposit} disabled={isLoading} className="flex-1 py-2.5 bg-tk/20 hover:bg-tk/30 text-tk font-medium rounded-lg text-sm transition-colors disabled:opacity-50">
                {isLoading ? 'Processing...' : 'Confirm Deposit'}
              </button>
              <button onClick={() => { setShowDeposit(false); setAmount(''); }} className="px-4 py-2.5 bg-white/5 text-white/60 rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        )}

        {/* Withdraw Form */}
        {showWithdraw && (
          <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-3">
            <h3 className="text-white font-semibold">Withdraw TK → ROGAN</h3>
            {!wallet?.wallet_address && (
              <p className="text-amber-400 text-xs">You need to link a wallet address first to withdraw.</p>
            )}
            <input type="number" placeholder="TK Amount (min 100)" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50" />
            <p className="text-white/30 text-xs">2% withdrawal fee applies</p>
            <div className="flex gap-2">
              <button onClick={handleWithdraw} disabled={isLoading || !wallet?.wallet_address} className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-white/70 font-medium rounded-lg text-sm transition-colors disabled:opacity-50">
                {isLoading ? 'Processing...' : 'Confirm Withdraw'}
              </button>
              <button onClick={() => { setShowWithdraw(false); setAmount(''); }} className="px-4 py-2.5 bg-white/5 text-white/60 rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        )}

        {/* Link Wallet Form */}
        {showLink && (
          <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-3">
            <h3 className="text-white font-semibold">Link Crypto Wallet</h3>
            {wallet?.wallet_address && (
              <p className="text-green-400/70 text-xs">Currently linked: {wallet.wallet_address.slice(0, 10)}...{wallet.wallet_address.slice(-6)}</p>
            )}
            <input type="text" placeholder="Wallet Address (0x...)" value={walletAddress} onChange={(e) => setWalletAddress(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white font-mono placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50" />
            <div className="flex gap-2">
              <button onClick={handleLink} disabled={isLoading} className="flex-1 py-2.5 bg-vip/20 hover:bg-vip/30 text-vip font-medium rounded-lg text-sm transition-colors disabled:opacity-50">
                {isLoading ? 'Linking...' : 'Link Wallet'}
              </button>
              <button onClick={() => { setShowLink(false); setWalletAddress(''); }} className="px-4 py-2.5 bg-white/5 text-white/60 rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        )}

        {/* Transaction History */}
        <div className="bg-surface rounded-xl border border-white/5">
          <div className="flex items-center justify-between p-4 border-b border-white/5">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <History className="w-4 h-4 text-white/40" />
              Transaction History
            </h3>
          </div>
          {transactions.length === 0 ? (
            <p className="text-white/30 text-sm text-center py-8">No transactions yet</p>
          ) : (
            <div className="divide-y divide-white/5">
              {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs', tx.type.includes('receive') || tx.type === 'deposit' || tx.type === 'gift_receive' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400')}>
                    {tx.type.includes('receive') || tx.type === 'deposit' ? '↓' : '↑'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium capitalize">{tx.type.replace(/_/g, ' ')}</p>
                    <p className="text-white/30 text-xs">{tx.created_at ? timeAgo(tx.created_at) : ''}</p>
                  </div>
                  <span className={cn('text-sm font-medium', tx.amount >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {tx.amount >= 0 ? '+' : ''}{formatTK(tx.amount)} TK
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
