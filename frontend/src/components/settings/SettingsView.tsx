'use client';

import { useState, useEffect } from 'react';
import { Settings, User, Video, Shield, Check, Star, Zap, Crown, AlertCircle, ChevronRight, AlertTriangle, Clock } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import api, { getErrorMessage } from '@/lib/api';

type Section = 'profile' | 'account' | 'creator';

export default function SettingsView() {
  const isMobile = useIsMobile(960);
  const [section, setSection] = useState<Section>('profile');

  return (
    <div className={cn('h-full overflow-y-auto scrollbar-thin', isMobile ? 'p-4 pb-24' : 'p-6')}>
      <div className="max-w-2xl mx-auto space-y-6">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-rogan-500" />
          Settings
        </h2>
        <div className="flex gap-2 bg-surface rounded-xl p-1 border border-white/5">
          {([
            { id: 'profile', label: 'Profile', icon: User },
            { id: 'creator', label: 'Creator', icon: Video },
            { id: 'account', label: 'Account', icon: Shield },
          ] as { id: Section; label: string; icon: React.ComponentType<{className?: string}> }[]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSection(tab.id)}
              className={cn('flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors', section === tab.id ? 'bg-rogan-600 text-white' : 'text-white/50 hover:text-white')}
            >
              <tab.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
        {section === 'profile' && <ProfileSection />}
        {section === 'creator' && <CreatorSection />}
        {section === 'account' && <AccountSection />}
      </div>
    </div>
  );
}

function ProfileSection() {
  const { user, updateProfile } = useAuthStore();
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      await updateProfile({ display_name: displayName, bio, avatar: avatar || null });
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-surface rounded-xl border border-white/5 p-5 space-y-5">
      <h3 className="text-white font-semibold flex items-center gap-2"><User className="w-4 h-4 text-white/40" /> Edit Profile</h3>
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0 overflow-hidden">
          {avatar ? <img src={avatar} alt="" className="w-full h-full object-cover" /> : (user?.username || 'U').charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          <label className="text-white/60 text-xs mb-1 block">Avatar URL</label>
          <input type="url" value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="https://example.com/avatar.jpg" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-rogan-500/50" />
        </div>
      </div>
      <div>
        <label className="text-white/60 text-xs mb-1.5 block">Display Name</label>
        <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={user?.username} maxLength={100} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-rogan-500/50" />
      </div>
      <div>
        <label className="text-white/60 text-xs mb-1.5 block">Bio</label>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell people about yourself..." rows={3} maxLength={500} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm resize-none focus:outline-none focus:border-rogan-500/50" />
        <p className="text-white/20 text-xs mt-1 text-right">{bio.length}/500</p>
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button onClick={handleSave} disabled={saving} className="w-full py-2.5 bg-rogan-600 hover:bg-rogan-700 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
        {saved ? <><Check className="w-4 h-4" /> Saved!</> : saving ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  );
}

function CreatorSection() {
  const { user, checkAuth } = useAuthStore();
  const [upgrading, setUpgrading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const isCreator = user?.role === 'creator' || user?.role === 'admin';

  const handleUpgrade = async () => {
    setUpgrading(true); setError('');
    try {
      await api.post('/auth/me/upgrade-creator');
      await checkAuth();
      setSuccess(true);
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setUpgrading(false); }
  };

  if (isCreator || success) {
    return (
      <div className="bg-surface rounded-xl border border-rogan-500/30 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-rogan-600/20 flex items-center justify-center"><Star className="w-5 h-5 text-rogan-400" /></div>
          <div><h3 className="text-white font-semibold">You&apos;re a Creator!</h3><p className="text-white/40 text-sm">All creator features unlocked</p></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: Video, label: 'Go Live', desc: 'Stream to your audience', soon: false },
            { icon: Crown, label: 'Subscriptions', desc: 'Monthly tier income', soon: true },
            { icon: Zap, label: 'Private Shows', desc: 'Exclusive paid content', soon: false },
            { icon: Star, label: 'PK Battles', desc: 'Compete with creators', soon: true },
          ].map((f) => (
            <div key={f.label} className="flex items-start gap-2 bg-white/5 rounded-lg p-3 relative">
              <f.icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${f.soon ? 'text-white/20' : 'text-rogan-400'}`} />
              <div>
                <p className={`text-xs font-medium ${f.soon ? 'text-white/30' : 'text-white'}`}>{f.label}</p>
                <p className="text-white/30 text-[10px]">{f.soon ? 'Coming soon' : f.desc}</p>
              </div>
              {f.soon && (
                <span className="absolute top-1.5 right-1.5 text-[9px] font-semibold bg-white/10 text-white/40 px-1.5 py-0.5 rounded-full">SOON</span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-xl border border-white/5 p-5 space-y-5">
      <h3 className="text-white font-semibold flex items-center gap-2"><Video className="w-4 h-4 text-white/40" /> Become a Creator</h3>
      <p className="text-white/50 text-sm leading-relaxed">Unlock live streaming, subscriptions, private shows, gifts, PK battles, and more.</p>
      <div className="space-y-3">
        {[
          { icon: Video, label: 'Go Live', desc: 'Stream with LL-HLS', soon: false },
          { icon: Crown, label: 'Subscription Tiers', desc: 'Earn monthly TK', soon: true },
          { icon: Zap, label: 'Private Shows', desc: 'Entry-fee sessions', soon: false },
          { icon: Star, label: 'PK Battles', desc: 'Real-time battles', soon: true },
        ].map((f) => (
          <div key={f.label} className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${f.soon ? 'bg-white/5' : 'bg-rogan-600/20'}`}>
              <f.icon className={`w-4 h-4 ${f.soon ? 'text-white/20' : 'text-rogan-400'}`} />
            </div>
            <div className="flex-1">
              <p className={`text-sm font-medium ${f.soon ? 'text-white/30' : 'text-white'}`}>{f.label}</p>
              <p className="text-white/40 text-xs">{f.soon ? 'Coming soon' : f.desc}</p>
            </div>
            {f.soon
              ? <span className="text-[10px] font-semibold bg-white/10 text-white/30 px-2 py-0.5 rounded-full">SOON</span>
              : <Check className="w-4 h-4 text-green-400" />
            }
          </div>
        ))}
      </div>
      {error && <div className="flex items-center gap-2 text-red-400 text-xs bg-red-900/20 rounded-lg px-3 py-2"><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>}
      <button onClick={handleUpgrade} disabled={upgrading} className="w-full py-3 bg-gradient-to-r from-rogan-600 to-pink-600 hover:opacity-90 text-white rounded-lg font-semibold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2">
        {upgrading ? 'Upgrading...' : <><Zap className="w-4 h-4" /> Become a Creator — Free</>}
      </button>
      <p className="text-white/20 text-xs text-center">Instant access, no approval needed.</p>
    </div>
  );
}
// ─── Appeal Section ────────────────────────────────────────────────────────────

function AppealSection() {
  const [ban, setBan] = useState<{ id: string; ban_type: string; reason: string; expires_at: string | null } | null>(null);
  const [appeal, setAppeal] = useState<{ id: string; status: string; reason: string; reviewer_note: string | null } | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    // Fetch active ban for this user
    api.get('/moderation/my-ban').then((r) => {
      setBan(r.data.ban ?? null);
      setAppeal(r.data.appeal ?? null);
    }).catch(() => {});
  }, []);

  const submit = async () => {
    if (!reason.trim()) return;
    setSubmitting(true);
    try {
      await api.post('/moderation/appeals', { reason: reason.trim(), ban_id: ban?.id ?? null });
      setMsg({ text: 'Appeal submitted. Moderators will review it shortly.', ok: true });
      setReason('');
      // Refresh appeal status
      api.get('/moderation/my-ban').then((r) => { setAppeal(r.data.appeal ?? null); }).catch(() => {});
    } catch (e) {
      setMsg({ text: getErrorMessage(e), ok: false });
    } finally {
      setSubmitting(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  if (!ban) return null;

  const BAN_LABEL: Record<string, string> = {
    full_ban: 'Account Banned',
    live_suspend: 'Live Suspended',
    chat_mute: 'Chat Muted'  };

  return (
    <div className="bg-surface rounded-xl border border-red-500/20 p-5 space-y-4">
      {/* Ban info header */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="w-4 h-4 text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-red-400 font-semibold text-sm">{BAN_LABEL[ban.ban_type] ?? ban.ban_type}</p>
          <p className="text-white/50 text-xs mt-0.5">{ban.reason}</p>
          {ban.expires_at ? (
            <p className="text-white/30 text-xs mt-1 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Expires {new Date(ban.expires_at).toLocaleDateString()}
            </p>
          ) : (
            <p className="text-white/30 text-xs mt-1">Permanent</p>
          )}
        </div>
      </div>

      {/* Existing appeal status */}
      {appeal && (
        <div className={`rounded-lg px-3 py-2.5 text-xs space-y-1 ${
          appeal.status === 'approved' ? 'bg-green-900/20 border border-green-500/20' :
          appeal.status === 'rejected' ? 'bg-red-900/20 border border-red-500/20' :
          'bg-white/5 border border-white/10'
        }`}>
          <p className="font-semibold text-white/80">
            {appeal.status === 'approved' && '✅ Appeal approved'}
            {appeal.status === 'rejected' && '❌ Appeal rejected'}
            {appeal.status === 'pending' && '⏳ Appeal under review'}
          </p>
          {appeal.reviewer_note && (
            <p className="text-white/50">{appeal.reviewer_note}</p>
          )}
        </div>
      )}

      {/* Appeal form — hide if pending or approved */}
      {(!appeal || appeal.status === 'rejected') && (
        <div className="space-y-3">
          <p className="text-white/60 text-xs">
            {appeal?.status === 'rejected'
              ? 'Your previous appeal was rejected. You may submit a new one.'
              : 'You can submit an appeal to have this reviewed by a moderator.'}
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why this ban should be lifted..."
            rows={3}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 resize-none"
          />
          {msg && (
            <p className={`text-xs ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>
          )}
          <button
            onClick={submit}
            disabled={submitting || !reason.trim()}
            className="w-full py-2.5 bg-rogan-600 hover:bg-rogan-700 disabled:opacity-40 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            {submitting ? 'Submitting...' : 'Submit Appeal'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Account Section ────────────────────────────────────────────────────────────

function AccountSection() {
  const { user, logout } = useAuthStore();
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw !== confirmPw) { setMsg({ text: 'Passwords do not match', ok: false }); return; }
    if (newPw.length < 8) { setMsg({ text: 'Password must be at least 8 characters', ok: false }); return; }
    setSaving(true);
    try {
      await api.post('/auth/change-password', { current_password: currentPw, new_password: newPw });
      setMsg({ text: 'Password updated successfully', ok: true });
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err) {
      setMsg({ text: getErrorMessage(err), ok: false });
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  return (
    <div className="space-y-4">
      <AppealSection />

      {/* Change Password */}
      <div className="bg-surface rounded-xl border border-white/5 p-5 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <Shield className="w-4 h-4 text-white/40" /> Change Password
        </h3>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <input
            type="password"
            placeholder="Current password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50"
          />
          <input
            type="password"
            placeholder="New password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50"
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50"
          />
          {msg && (
            <p className={`text-xs ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>
          )}
          <button
            type="submit"
            disabled={saving || !currentPw || !newPw || !confirmPw}
            className="w-full py-2.5 bg-rogan-600 hover:bg-rogan-700 disabled:opacity-40 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            {saving ? 'Saving...' : 'Update Password'}
          </button>
        </form>
      </div>

      {/* Danger zone */}
      <div className="bg-surface rounded-xl border border-red-500/10 p-5 space-y-3">
        <h3 className="text-red-400/80 font-semibold text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> Danger Zone
        </h3>
        <p className="text-white/30 text-xs">Signing out will end your session. You can sign back in at any time.</p>
        <button
          onClick={logout}
          className="w-full py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm font-medium border border-red-500/20 transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
