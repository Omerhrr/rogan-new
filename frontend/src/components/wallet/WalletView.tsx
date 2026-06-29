'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Wallet, ArrowDownCircle, ArrowUpCircle, Link2, History,
  Copy, Check, ExternalLink, AlertCircle, ChevronDown, Send, UserCheck, Loader2,
} from 'lucide-react';
import { useWalletStore } from '@/stores/walletStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatTK, cn, timeAgo } from '@/lib/utils';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

type Tab = 'overview' | 'deposit' | 'withdraw' | 'send' | 'history';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-amber-500/15 text-amber-400',
    approved: 'bg-blue-500/15 text-blue-400',
    completed: 'bg-green-500/15 text-green-400',
    rejected: 'bg-red-500/15 text-red-400',
    confirmed: 'bg-green-500/15 text-green-400',
    succeeded: 'bg-green-500/15 text-green-400',
    failed: 'bg-red-500/15 text-red-400',
  };
  return (
    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide', map[status] ?? 'bg-white/10 text-white/50')}>
      {status}
    </span>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className="text-white/30 hover:text-white/70 transition-colors">
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function WalletView() {
  const {
    walletInfo, withdrawals, depositHistory, sendHistory,
    fetchWallet, linkWalletAddress, depositCrypto,
    requestWithdrawal, fetchWithdrawals, fetchDepositHistory, fetchSendHistory, sendTK,
    isLoading, error, clearError,
  } = useWalletStore();
  const isMobile = useIsMobile(960);

  const [tab, setTab] = useState<Tab>('overview');

  const [linkAddress, setLinkAddress] = useState('');
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkSuccess, setLinkSuccess] = useState(false);

  const [txHash, setTxHash] = useState('');
  const [cryptoResult, setCryptoResult] = useState<{ amount_tk: number; amount_rogan: number; tx_hash: string } | null>(null);

  const [sendRecipient, setSendRecipient] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendResult, setSendResult] = useState<{ recipient_username: string; amount_tk: number } | null>(null);
  const [sendUserResults, setSendUserResults] = useState<{ id: string; username: string; display_name: string | null; avatar: string | null }[]>([]);
  const [sendSearching, setSendSearching] = useState(false);
  const [sendSelected, setSendSelected] = useState<{ id: string; username: string; display_name: string | null; avatar: string | null } | null>(null);
  const [showSendDropdown, setShowSendDropdown] = useState(false);
  const sendDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendInputRef = useRef<HTMLInputElement>(null);
  const [withdrawAmt, setWithdrawAmt] = useState('');
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);

  useEffect(() => {
    fetchWallet();
    fetchWithdrawals();
    fetchDepositHistory();
    fetchSendHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLinkAddress = async () => {
    if (!linkAddress.trim()) return;
    try {
      await linkWalletAddress(linkAddress.trim());
      setLinkSuccess(true);
      setShowLinkForm(false);
      setLinkAddress('');
      setTimeout(() => setLinkSuccess(false), 3000);
    } catch {}
  };

  const handleCryptoDeposit = async () => {
    if (!txHash.trim()) return;
    try {
      const result = await depositCrypto(txHash.trim());
      setCryptoResult(result);
      setTxHash('');
      fetchDepositHistory();
    } catch {}
  };

  const handleSend = async () => {
    const amt = parseFloat(sendAmount);
    if (!sendSelected || !amt || amt < 1) return;
    try {
      const result = await sendTK(sendSelected.username, amt);
      setSendResult(result);
      setSendSelected(null);
      setSendRecipient('');
      setSendAmount('');
      fetchSendHistory();
      setTimeout(() => setSendResult(null), 5000);
    } catch {}
  };

  const searchUsers = useCallback((q: string) => {
    if (sendDebounce.current) clearTimeout(sendDebounce.current);
    if (!q.trim() || q.length < 1) {
      setSendUserResults([]);
      setShowSendDropdown(false);
      return;
    }
    sendDebounce.current = setTimeout(async () => {
      setSendSearching(true);
      try {
        const res = await (await import('@/lib/api')).default.get('/auth/users/search', { params: { q, limit: 6 } });
        setSendUserResults(res.data.users ?? []);
        setShowSendDropdown(true);
      } catch { setSendUserResults([]); }
      finally { setSendSearching(false); }
    }, 280);
  }, []);

  const handleSelectUser = (u: { id: string; username: string; display_name: string | null; avatar: string | null }) => {
    setSendSelected(u);
    setSendRecipient(u.username);
    setShowSendDropdown(false);
    setSendUserResults([]);
  };

  const handleClearSendUser = () => {
    setSendSelected(null);
    setSendRecipient('');
    setSendUserResults([]);
    setShowSendDropdown(false);
    setTimeout(() => sendInputRef.current?.focus(), 50);
  };

  const handleWithdraw = async () => {
    const amt = parseFloat(withdrawAmt);
    if (!amt || amt < 10) return;
    try {
      await requestWithdrawal(amt);
      setWithdrawSuccess(true);
      setWithdrawAmt('');
      setTimeout(() => setWithdrawSuccess(false), 4000);
    } catch {}
  };

  const tkBalance = walletInfo?.tk_balance ?? 0;
  const walletAddress = walletInfo?.wallet_address ?? null;
  const roganPrice = walletInfo?.rogan_price_usd ?? 0;
  const platformWallet = walletInfo?.platform_wallet ?? null;

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Overview', icon: <Wallet className="w-4 h-4" /> },
    { key: 'deposit', label: 'Deposit', icon: <ArrowDownCircle className="w-4 h-4" /> },
    { key: 'withdraw', label: 'Withdraw', icon: <ArrowUpCircle className="w-4 h-4" /> },
    { key: 'send', label: 'Send', icon: <Send className="w-4 h-4" /> },
    { key: 'history', label: 'History', icon: <History className="w-4 h-4" /> },
  ];

  return (
    <div className={cn('h-full overflow-y-auto scrollbar-thin', isMobile ? 'p-4 pb-24' : 'p-6')}>
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Balance card */}
        <div className="bg-gradient-to-br from-rogan-600/30 via-purple-600/20 to-blue-600/30 rounded-2xl p-6 border border-white/10">
          <div className="flex items-center justify-between mb-1">
            <span className="text-white/50 text-xs">TK Balance</span>
            {roganPrice > 0 && (
              <span className="text-white/30 text-xs">
                1 TK ≈ {Math.round(0.1 / roganPrice).toLocaleString()} ROGAN
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-4xl font-bold text-white">{formatTK(tkBalance)}</span>
            <span className="text-tk text-lg font-semibold">TK</span>
          </div>

          <div className="mb-4">
            {walletAddress ? (
              <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                <Link2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                <span className="text-white/60 text-xs font-mono flex-1 truncate">
                  {walletAddress.slice(0, 12)}...{walletAddress.slice(-8)}
                </span>
                <CopyBtn text={walletAddress} />
                <button onClick={() => setShowLinkForm(true)} className="text-white/30 hover:text-white/60 text-xs">
                  change
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowLinkForm(true)}
                className="w-full text-left flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-amber-400 text-xs"
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Link your wallet address to deposit ROGAN or withdraw
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={() => setTab('deposit')} className="flex-1 py-2.5 bg-tk/20 hover:bg-tk/30 text-tk font-medium rounded-lg flex items-center justify-center gap-1.5 text-sm transition-colors">
              <ArrowDownCircle className="w-4 h-4" /> Deposit
            </button>
            <button onClick={() => setTab('withdraw')} className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-white/70 font-medium rounded-lg flex items-center justify-center gap-1.5 text-sm transition-colors">
              <ArrowUpCircle className="w-4 h-4" /> Withdraw
            </button>
          </div>
        </div>

        {/* Link wallet form */}
        {showLinkForm && (
          <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-3">
            <h3 className="text-white font-semibold text-sm">
              {walletAddress ? 'Update Linked Wallet' : 'Link Wallet Address'}
            </h3>
            <p className="text-white/40 text-xs">
              Paste your Base chain wallet address. No MetaMask connection needed — just paste the address.
              This wallet will be used to verify ROGAN deposits and receive withdrawals.
            </p>
            <input
              type="text"
              value={linkAddress}
              onChange={(e) => setLinkAddress(e.target.value)}
              placeholder="0x000...0000"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-rogan-500/50"
            />
            <div className="flex gap-2">
              <button
                onClick={handleLinkAddress}
                disabled={isLoading || !linkAddress.trim()}
                className="flex-1 py-2.5 bg-tk/20 hover:bg-tk/30 text-tk font-medium rounded-lg text-sm disabled:opacity-50"
              >
                {isLoading ? 'Linking...' : 'Link Address'}
              </button>
              <button onClick={() => { setShowLinkForm(false); setLinkAddress(''); }} className="px-4 py-2.5 bg-white/5 text-white/50 rounded-lg text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        {linkSuccess && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 text-green-400 text-sm flex items-center gap-2">
            <Check className="w-4 h-4" /> Wallet address linked successfully
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm flex items-center justify-between">
            {error}
            <button onClick={clearError} className="text-red-400/50 hover:text-red-400 text-lg leading-none">x</button>
          </div>
        )}

        {/* Tab navigation */}
        <div className="flex gap-1 bg-white/5 rounded-xl p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all',
                tab === t.key ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
              )}
            >
              {t.icon}
              {!isMobile && <span>{t.label}</span>}
            </button>
          ))}
        </div>

        {/* Overview */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="bg-surface rounded-xl p-4 border border-white/5 space-y-3">
              <h3 className="text-white/70 text-xs font-semibold uppercase tracking-wider">Exchange Rates</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    label: 'ROGAN Price',
                    value: roganPrice > 0 ? `$${roganPrice.toFixed(8)}` : '—',
                    accent: true,
                  },
                  {
                    label: '1 TK costs',
                    value: roganPrice > 0
                      ? `${Math.round(0.1 / roganPrice).toLocaleString()} ROGAN`
                      : '—',
                  },
                  {
                    label: '1M ROGAN =',
                    value: roganPrice > 0
                      ? `$${(roganPrice * 1_000_000).toFixed(4)} USD`
                      : '—',
                  },
                  {
                    label: 'Rate',
                    value: '$1.00 = 10 TK',
                  },
                ].map((item) => (
                  <div key={item.label} className="bg-white/5 rounded-lg p-3">
                    <p className="text-white/40 text-xs mb-1">{item.label}</p>
                    <p className={cn('font-semibold text-sm', item.accent ? 'text-tk' : 'text-white')}>{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {withdrawals.filter(w => w.status === 'pending' || w.status === 'approved').length > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 space-y-2">
                <p className="text-amber-400 text-xs font-semibold">Pending Withdrawals</p>
                {withdrawals.filter(w => w.status === 'pending' || w.status === 'approved').map(w => (
                  <div key={w.id} className="flex items-center justify-between">
                    <span className="text-white/60 text-sm">{formatTK(w.amount_tk)} TK</span>
                    <StatusBadge status={w.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Deposit */}
        {tab === 'deposit' && (
          <div className="space-y-4">
            {(

              <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-4">
                <div>
                  <h3 className="text-white font-semibold text-sm mb-1">Deposit ROGAN</h3>
                  <p className="text-white/40 text-xs">Buy ROGAN on Base, send to the platform wallet, then submit the tx hash here.</p>
                </div>

                {platformWallet ? (
                  <div className="bg-white/5 rounded-lg p-3 space-y-1">
                    <p className="text-white/40 text-[11px]">Send ROGAN to (Base chain):</p>
                    <div className="flex items-center gap-2">
                      <span className="text-white text-xs font-mono flex-1 break-all">{platformWallet}</span>
                      <CopyBtn text={platformWallet} />
                    </div>
                  </div>
                ) : (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-amber-400 text-xs">
                    Platform wallet not configured yet.
                  </div>
                )}

                {!walletAddress && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-amber-400 text-xs flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    Link your wallet address first (scroll up to the card above).
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-white/50 text-xs">Transaction Hash</label>
                  <input
                    type="text"
                    value={txHash}
                    onChange={(e) => setTxHash(e.target.value)}
                    placeholder="0x..."
                    disabled={!walletAddress || !platformWallet}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-tk/50 disabled:opacity-40"
                  />
                  {walletAddress && (
                    <p className="text-white/30 text-[11px]">
                      The tx must be sent FROM {walletAddress.slice(0, 10)}... — any other sender is rejected.
                    </p>
                  )}
                </div>

                <button
                  onClick={handleCryptoDeposit}
                  disabled={isLoading || !txHash.trim() || !walletAddress || !platformWallet}
                  className="w-full py-3 bg-tk/20 hover:bg-tk/30 text-tk font-medium rounded-lg text-sm transition-colors disabled:opacity-40"
                >
                  {isLoading ? 'Verifying on Base...' : 'Verify & Deposit'}
                </button>

                {cryptoResult && (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 space-y-1">
                    <p className="text-green-400 font-semibold text-sm">Deposit confirmed!</p>
                    <p className="text-white/60 text-xs">
                      {cryptoResult.amount_rogan.toLocaleString()} ROGAN added <span className="text-tk font-medium">{formatTK(cryptoResult.amount_tk)} TK</span>
                    </p>
                    <a href={`https://basescan.org/tx/${cryptoResult.tx_hash}`} target="_blank" rel="noreferrer" className="text-white/30 text-[11px] flex items-center gap-1 hover:text-white/60">
                      View on Basescan <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}

                <details className="group">
                  <summary className="text-white/30 text-xs cursor-pointer flex items-center gap-1 select-none list-none">
                    <ChevronDown className="w-3.5 h-3.5 group-open:rotate-180 transition-transform" />
                    How it works
                  </summary>
                  <div className="mt-2 text-white/30 text-[11px] space-y-1 pl-4">
                    <p>1. Buy ROGAN on Base (Uniswap, etc.)</p>
                    <p>2. Send ROGAN FROM your linked wallet to the platform wallet above</p>
                    <p>3. Copy the transaction hash from Basescan</p>
                    <p>4. Paste it here — we verify on-chain and credit TK instantly</p>
                    <p>Rate: 1,000,000 ROGAN = $1.00 = 10 TK (live price via DexScreener)</p>
                  </div>
                </details>
              </div>
            )}
          </div>
        )}

        {/* Withdraw */}
        {tab === 'withdraw' && (
          <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-4">
            <div>
              <h3 className="text-white font-semibold text-sm mb-1">Withdraw TK as ROGAN</h3>
              <p className="text-white/40 text-xs">
                Withdrawals are processed manually by admin. ROGAN is sent to your linked wallet. Allow 24-72 hours.
              </p>
            </div>

            {!walletAddress && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5 text-amber-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Link a wallet address first (shown at the top of this page).
              </div>
            )}

            <div className="space-y-1">
              <label className="text-white/50 text-xs">Amount (TK) — minimum 10 TK</label>
              <input
                type="number"
                value={withdrawAmt}
                onChange={(e) => setWithdrawAmt(e.target.value)}
                placeholder="0"
                min={10}
                disabled={!walletAddress}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 disabled:opacity-40"
              />
              {withdrawAmt && parseFloat(withdrawAmt) > 0 && (
                <p className="text-white/30 text-[11px]">
                  ~${(parseFloat(withdrawAmt) / 10).toFixed(4)} USD worth of ROGAN
                </p>
              )}
            </div>

            {walletAddress && (
              <div className="bg-white/5 rounded-lg px-3 py-2 space-y-0.5">
                <p className="text-white/30 text-[11px]">Sends ROGAN to:</p>
                <p className="text-white/70 text-xs font-mono">{walletAddress.slice(0, 14)}...{walletAddress.slice(-8)}</p>
              </div>
            )}

            <ul className="text-white/25 text-[11px] space-y-0.5">
              <li>Available: <span className="text-white/50">{formatTK(tkBalance)} TK</span></li>
              <li>Processing time: 24-72 hours (manual)</li>
              <li>TK is held immediately, returned if rejected</li>
            </ul>

            <button
              onClick={handleWithdraw}
              disabled={isLoading || !walletAddress || !withdrawAmt || parseFloat(withdrawAmt) < 10}
              className="w-full py-3 bg-white/5 hover:bg-white/10 text-white/70 font-medium rounded-lg text-sm transition-colors disabled:opacity-40"
            >
              {isLoading ? 'Submitting...' : 'Request Withdrawal'}
            </button>

            {withdrawSuccess && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 text-green-400 text-sm">
                Withdrawal request submitted. Admin will process within 24-72 hours.
              </div>
            )}
          </div>
        )}


        {/* Send */}
        {tab === 'send' && (
          <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-4">
            <div>
              <h3 className="text-white font-semibold text-sm mb-1">Send TK</h3>
              <p className="text-white/40 text-xs">Transfer TK to any Rogan Live user instantly by their username.</p>
            </div>

            {/* Recipient search */}
            <div className="space-y-1">
              <label className="text-white/50 text-xs">Recipient</label>

              {sendSelected ? (
                /* Confirmed user pill */
                <div className="flex items-center gap-3 bg-tk/10 border border-tk/30 rounded-xl px-3 py-2.5">
                  {sendSelected.avatar ? (
                    <img src={sendSelected.avatar} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                      <span className="text-white/50 text-xs font-bold">{sendSelected.username[0].toUpperCase()}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">@{sendSelected.username}</p>
                    {sendSelected.display_name && (
                      <p className="text-white/40 text-xs truncate">{sendSelected.display_name}</p>
                    )}
                  </div>
                  <UserCheck className="w-4 h-4 text-tk shrink-0" />
                  <button onClick={handleClearSendUser} className="text-white/30 hover:text-white/70 text-lg leading-none shrink-0">×</button>
                </div>
              ) : (
                /* Search input with dropdown */
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm select-none">@</span>
                  {sendSearching ? (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 animate-spin" />
                  ) : null}
                  <input
                    ref={sendInputRef}
                    type="text"
                    value={sendRecipient}
                    onChange={(e) => {
                      const v = e.target.value.replace('@', '');
                      setSendRecipient(v);
                      setSendSelected(null);
                      searchUsers(v);
                    }}
                    onBlur={() => setTimeout(() => setShowSendDropdown(false), 150)}
                    onFocus={() => { if (sendUserResults.length > 0) setShowSendDropdown(true); }}
                    placeholder="Search by username..."
                    autoComplete="off"
                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-7 pr-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-tk/50"
                  />

                  {showSendDropdown && sendUserResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-white/10 rounded-xl overflow-hidden z-50 shadow-xl">
                      {sendUserResults.map((u) => (
                        <button
                          key={u.id}
                          onMouseDown={() => handleSelectUser(u)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
                        >
                          {u.avatar ? (
                            <img src={u.avatar} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                              <span className="text-white/50 text-xs font-bold">{u.username[0].toUpperCase()}</span>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium">@{u.username}</p>
                            {u.display_name && (
                              <p className="text-white/40 text-xs truncate">{u.display_name}</p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {sendRecipient.length >= 1 && !sendSearching && sendUserResults.length === 0 && !showSendDropdown && (
                    <p className="text-red-400/70 text-[11px] mt-1">No users found for &quot;{sendRecipient}&quot;</p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-white/50 text-xs">Amount (TK) — minimum 1 TK</label>
              <input
                type="number"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
                placeholder="0"
                min={1}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-tk/50"
              />
              {sendAmount && parseFloat(sendAmount) > 0 && (
                <p className="text-white/30 text-[11px]">
                  ~${(parseFloat(sendAmount) / 10).toFixed(4)} USD value
                </p>
              )}
            </div>

            <div className="bg-white/5 rounded-lg px-4 py-3 flex items-center justify-between">
              <span className="text-white/40 text-sm">Your balance</span>
              <span className="text-white font-medium text-sm">{formatTK(tkBalance)} TK</span>
            </div>

            <button
              onClick={handleSend}
              disabled={isLoading || !sendSelected || !sendAmount || parseFloat(sendAmount) < 1}
              className="w-full py-3 bg-tk/20 hover:bg-tk/30 text-tk font-medium rounded-lg text-sm transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              {isLoading ? 'Sending...' : 'Send TK'}
            </button>

            {sendResult && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 text-green-400 text-sm flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" />
                Sent {formatTK(sendResult.amount_tk)} TK to @{sendResult.recipient_username}
              </div>
            )}

            <p className="text-white/20 text-[11px] text-center">Sends are instant and cannot be reversed</p>
          </div>
        )}

        {/* History */}
        {tab === 'history' && (
          <div className="space-y-4">
            <div className="bg-surface rounded-xl border border-white/5">
              <div className="px-4 py-3 border-b border-white/5">
                <h3 className="text-white/70 text-xs font-semibold uppercase tracking-wider">Deposits</h3>
              </div>
              {depositHistory.length === 0 ? (
                <p className="text-white/20 text-xs text-center py-6">No deposits yet</p>
              ) : (
                <div className="divide-y divide-white/5">
                  {depositHistory.map((d) => (
                    <div key={d.id} className="px-4 py-3 flex items-center gap-3">
                      <span className="text-lg">{d.type === 'rogan' ? '🪙' : '💳'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium">+{formatTK(d.amount_tk)} TK</p>
                        <p className="text-white/30 text-[11px]">
                          {d.type === 'rogan'
                            ? `${(d.amount_rogan ?? 0).toLocaleString()} ROGAN · $${d.amount_usd?.toFixed(4)}`
                            : `$${d.amount_usd?.toFixed(2)} card`}
                          {d.created_at ? ` · ${timeAgo(d.created_at)}` : ''}
                        </p>
                        {d.tx_hash && (
                          <a href={`https://basescan.org/tx/${d.tx_hash}`} target="_blank" rel="noreferrer" className="text-white/20 text-[10px] flex items-center gap-0.5 hover:text-white/50">
                            {d.tx_hash.slice(0, 14)}... <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                      <StatusBadge status={d.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-surface rounded-xl border border-white/5">
              <div className="px-4 py-3 border-b border-white/5">
                <h3 className="text-white/70 text-xs font-semibold uppercase tracking-wider">Withdrawals</h3>
              </div>
              {withdrawals.length === 0 ? (
                <p className="text-white/20 text-xs text-center py-6">No withdrawals yet</p>
              ) : (
                <div className="divide-y divide-white/5">
                  {withdrawals.map((w) => (
                    <div key={w.id} className="px-4 py-3 flex items-center gap-3">
                      <span className="text-base text-white/40">↑</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium">{formatTK(w.amount_tk)} TK</p>
                        <p className="text-white/30 text-[11px]">
                          {w.amount_rogan ? `${w.amount_rogan.toLocaleString()} ROGAN` : 'Amount TBD'}
                          {w.requested_at ? ` · ${timeAgo(w.requested_at)}` : ''}
                        </p>
                        {w.wallet_address && (
                          <p className="text-white/20 text-[10px] font-mono">{w.wallet_address.slice(0, 10)}...{w.wallet_address.slice(-6)}</p>
                        )}
                        {w.tx_hash && (
                          <a href={`https://basescan.org/tx/${w.tx_hash}`} target="_blank" rel="noreferrer" className="text-white/20 text-[10px] flex items-center gap-0.5 hover:text-white/50">
                            {w.tx_hash.slice(0, 14)}... <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                        {w.rejection_reason && (
                          <p className="text-red-400/60 text-[10px]">Reason: {w.rejection_reason}</p>
                        )}
                      </div>
                      <StatusBadge status={w.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sends & Receives */}
            <div className="bg-surface rounded-xl border border-white/5">
              <div className="px-4 py-3 border-b border-white/5">
                <h3 className="text-white/70 text-xs font-semibold uppercase tracking-wider">Sends & Receives</h3>
              </div>
              {sendHistory.length === 0 ? (
                <p className="text-white/20 text-xs text-center py-6">No TK transfers yet</p>
              ) : (
                <div className="divide-y divide-white/5">
                  {sendHistory.map((s) => (
                    <div key={s.id} className="px-4 py-3 flex items-center gap-3">
                      {s.other_avatar ? (
                        <img src={s.other_avatar} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                          <span className="text-white/50 text-xs font-bold">{s.other_username[0]?.toUpperCase()}</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium">
                          {s.direction === 'sent' ? 'Sent to' : 'Received from'} @{s.other_username}
                        </p>
                        <p className="text-white/30 text-[11px]">
                          {s.direction === 'sent' ? '-' : '+'}{formatTK(s.amount_tk)} TK
                          {s.created_at ? ` · ${timeAgo(s.created_at)}` : ''}
                        </p>
                      </div>
                      <span className={cn('font-semibold text-sm', s.direction === 'sent' ? 'text-red-400' : 'text-green-400')}>
                        {s.direction === 'sent' ? '-' : '+'}{formatTK(s.amount_tk)} TK
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
