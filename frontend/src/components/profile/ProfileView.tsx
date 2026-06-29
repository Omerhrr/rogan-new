'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  User, Edit3, Save, X, Radio, Calendar,
  UserPlus, UserCheck, MessageSquare, Camera, Users,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/use-mobile';
import api from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import type { User as UserType } from '@/types';

interface ProfileViewProps {
  userId: string | null;
  onOpenStream?: (streamId: string) => void;
  onOpenDM?: (userId: string) => void;
  onOpenProfile?: (userId: string) => void;
}

interface FollowStats { is_following: boolean; followers: number; following: number }
interface Stream { id: string; title: string; is_live: boolean; viewer_count: number; category: string | null; created_at: string | null }
interface SocialUser { id: string; username: string; display_name: string | null; avatar: string | null; is_live: boolean; role: string }

type ProfileTab = 'about' | 'streams' | 'followers' | 'following';

export default function ProfileView({ userId, onOpenStream, onOpenDM, onOpenProfile }: ProfileViewProps) {
  const { user: currentUser, updateProfile } = useAuthStore();
  const isMobile = useIsMobile(960);
  const [profileUser, setProfileUser] = useState<UserType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<ProfileTab>('about');
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [followStats, setFollowStats] = useState<FollowStats>({ is_following: false, followers: 0, following: 0 });
  const [followLoading, setFollowLoading] = useState(false);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [followers, setFollowers] = useState<SocialUser[]>([]);
  const [following, setFollowing] = useState<SocialUser[]>([]);
  const [contentLoading, setContentLoading] = useState(false);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const isOwnProfile = !userId || userId === currentUser?.id;
  const targetId = isOwnProfile ? currentUser?.id : userId;

  const loadProfile = useCallback(async () => {
    if (isOwnProfile) {
      setProfileUser((prev) => prev ?? currentUser);
      setIsLoading(false);
      return;
    }
    if (!userId) return;
    setIsLoading(true);
    try {
      const res = await api.get(`/auth/users/${userId}`);
      setProfileUser(res.data);
    } catch { setProfileUser(null); }
    finally { setIsLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, isOwnProfile]);

  const loadFollowStats = useCallback(async () => {
    if (!targetId) return;
    try {
      if (isOwnProfile) {
        const res = await api.get(`/auth/users/${targetId}/stats`);
        setFollowStats({ is_following: false, followers: res.data.followers, following: res.data.following });
      } else {
        const res = await api.get(`/auth/users/${targetId}/follow-status`);
        setFollowStats(res.data);
      }
    } catch { /* non-critical */ }
  }, [targetId, isOwnProfile]);

  const loadTabContent = useCallback(async (t: ProfileTab) => {
    if (!targetId || t === 'about') return;
    setContentLoading(true);
    try {
      if (t === 'streams') {
        const res = await api.get('/streams/live', { params: { limit: 10 } });
        setStreams((res.data.streams || []).filter((s: Stream & { creator_id: string }) => s.creator_id === targetId));
      } else if (t === 'followers') {
        const res = await api.get(`/auth/users/${targetId}/followers`);
        setFollowers(res.data.users || []);
      } else if (t === 'following') {
        const res = await api.get(`/auth/users/${targetId}/following`);
        setFollowing(res.data.users || []);
      }
    } catch { /* silent */ }
    finally { setContentLoading(false); }
  }, [targetId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => { loadFollowStats(); }, [loadFollowStats]);
  useEffect(() => { loadTabContent(tab); }, [tab, loadTabContent]);

  const handleFollow = async () => {
    if (!targetId) return;
    setFollowLoading(true);
    try {
      if (followStats.is_following) {
        await api.delete(`/auth/users/${targetId}/follow`);
        setFollowStats((s) => ({ ...s, is_following: false, followers: Math.max(0, s.followers - 1) }));
      } else {
        await api.post(`/auth/users/${targetId}/follow`);
        setFollowStats((s) => ({ ...s, is_following: true, followers: s.followers + 1 }));
      }
    } catch { /* silent */ }
    finally { setFollowLoading(false); }
  };

  const handleAvatarUpload = async (file: File) => {
    setUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post('/auth/users/me/avatar', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      const url = res.data.avatar_url;
      useAuthStore.setState((s) => ({ user: s.user ? { ...s.user, avatar: url } : s.user }));
      setProfileUser((p) => p ? { ...p, avatar: url } : p);
    } catch { /* silent */ }
    finally { setUploadingAvatar(false); }
  };

  const handleBannerUpload = async (file: File) => {
    setUploadingBanner(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post('/auth/users/me/banner', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      const url = res.data.banner_url;
      useAuthStore.setState((s) => ({ user: s.user ? { ...s.user, banner_url: url } : s.user }));
      setProfileUser((p) => p ? { ...p, banner_url: url } : p);
    } catch { /* silent */ }
    finally { setUploadingBanner(false); }
  };

  const saveProfile = async () => {
    setIsSaving(true);
    try {
      await updateProfile({ display_name: editName, bio: editBio });
      setIsEditing(false);
    } catch { /* handled by store */ }
    finally { setIsSaving(false); }
  };

  if (isLoading) return <LoadingSpinner className="h-full" />;
  if (!profileUser) return (
    <div className="h-full flex items-center justify-center"><p className="text-white/40">User not found</p></div>
  );

  const isCreator = profileUser.role === 'creator' || profileUser.role === 'admin';

  // Reusable user list row
  const UserRow = ({ u }: { u: SocialUser }) => (
    <button
      key={u.id}
      onClick={() => onOpenProfile?.(u.id)}
      className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white/5 transition-colors text-left"
    >
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {u.avatar
          ? <img src={u.avatar} alt="" className="w-full h-full object-cover" />
          : <span className="text-white text-sm font-bold">{u.username.charAt(0).toUpperCase()}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-medium truncate">{u.display_name || u.username}</p>
        <p className="text-white/40 text-xs">@{u.username}</p>
      </div>
      {u.is_live && (
        <span className="bg-rogan-600/20 text-rogan-400 text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0">LIVE</span>
      )}
      {isCreator && u.role === 'creator' && !u.is_live && (
        <span className="text-white/20 text-[10px] flex-shrink-0">Creator</span>
      )}
    </button>
  );

  return (
    <div className={cn('h-full overflow-y-auto scrollbar-thin', isMobile ? 'pb-24' : 'p-6')}>
      <div className="max-w-2xl mx-auto space-y-0">

        {/* Profile Header */}
        <div className="bg-surface rounded-2xl overflow-hidden border border-white/5">

          {/* Banner */}
          <div
            className={cn('relative h-36 overflow-hidden', isOwnProfile && 'cursor-pointer group')}
            onClick={() => isOwnProfile && bannerInputRef.current?.click()}
          >
            {(profileUser as any).banner_url ? (
              <img src={(profileUser as any).banner_url} alt="Banner" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-r from-rogan-600/40 via-purple-600/30 to-blue-600/40" />
            )}
            {isOwnProfile && (
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                {uploadingBanner
                  ? <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  : <><Camera className="w-5 h-5 text-white" /><span className="text-white text-sm font-medium">Change Banner</span></>
                }
              </div>
            )}
            <input ref={bannerInputRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBannerUpload(f); e.target.value = ''; }} />
          </div>

          <div className="px-5 pb-5">
            {/* Avatar row */}
            <div className="flex items-end gap-4 -mt-10 mb-4">
              <div
                className={cn(
                  'relative w-20 h-20 rounded-full border-4 border-surface overflow-hidden bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0',
                  isOwnProfile && 'cursor-pointer group'
                )}
                onClick={() => isOwnProfile && avatarInputRef.current?.click()}
              >
                {profileUser.avatar
                  ? <img src={profileUser.avatar} alt="" className="w-full h-full object-cover" />
                  : <span>{profileUser.username.charAt(0).toUpperCase()}</span>
                }
                {isOwnProfile && (
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-full flex items-center justify-center">
                    {uploadingAvatar
                      ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      : <Camera className="w-4 h-4 text-white" />
                    }
                  </div>
                )}
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAvatarUpload(f); e.target.value = ''; }} />
              </div>
              <div className="flex-1 min-w-0 pt-10">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-white text-xl font-bold truncate">{profileUser.display_name || profileUser.username}</h1>
                  {isCreator && <span className="bg-rogan-600/20 text-rogan-400 text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide">Creator</span>}
                </div>
                <p className="text-white/40 text-sm">@{profileUser.username}</p>
              </div>
            </div>

            {/* Edit button (own profile) */}
            {isOwnProfile && !isEditing && (
              <button
                onClick={() => { setEditName(profileUser.display_name || ''); setEditBio(profileUser.bio || ''); setIsEditing(true); }}
                className="mb-3 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/70 rounded-lg text-sm flex items-center gap-2 transition-colors"
              >
                <Edit3 className="w-4 h-4" /> Edit Profile
              </button>
            )}

            {/* Edit form */}
            {isEditing && (
              <div className="space-y-3 mb-4">
                <input type="text" placeholder="Display Name" value={editName} onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50" />
                <textarea placeholder="Bio" value={editBio} onChange={(e) => setEditBio(e.target.value)} rows={3} maxLength={500}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 resize-none" />
                <div className="flex gap-2">
                  <button onClick={saveProfile} disabled={isSaving}
                    className="px-4 py-2 bg-rogan-600 text-white text-sm rounded-lg flex items-center gap-2 disabled:opacity-50">
                    <Save className="w-4 h-4" /> {isSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={() => setIsEditing(false)}
                    className="px-4 py-2 bg-white/5 text-white/60 text-sm rounded-lg flex items-center gap-2">
                    <X className="w-4 h-4" /> Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Other user actions */}
            {!isOwnProfile && (
              <div className="flex gap-2 mb-4">
                <button onClick={handleFollow} disabled={followLoading}
                  className={cn('px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50',
                    followStats.is_following
                      ? 'bg-white/5 hover:bg-red-900/20 text-white/60 hover:text-red-400 border border-white/10'
                      : 'bg-rogan-600 hover:bg-rogan-700 text-white')}>
                  {followStats.is_following ? <><UserCheck className="w-4 h-4" /> Following</> : <><UserPlus className="w-4 h-4" /> Follow</>}
                </button>
                {onOpenDM && (
                  <button onClick={() => onOpenDM(profileUser.id)}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/70 rounded-lg text-sm flex items-center gap-2 transition-colors">
                    <MessageSquare className="w-4 h-4" /> Message
                  </button>
                )}
              </div>
            )}

            {/* Bio */}
            {!isEditing && profileUser.bio && <p className="text-white/60 text-sm mb-4 leading-relaxed">{profileUser.bio}</p>}

            {/* Stats */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Followers', value: followStats.followers.toLocaleString() },
                { label: 'Following', value: followStats.following.toLocaleString() },
                { label: 'Status',   value: profileUser.is_live ? '🔴 Live' : 'Offline' },
                { label: 'Role',     value: profileUser.role },
              ].map((s) => (
                <div key={s.label} className="bg-white/5 rounded-xl p-3 text-center">
                  <p className={cn('font-bold text-sm', s.label === 'Status' && profileUser.is_live ? 'text-rogan-500' : 'text-white')}>{s.value}</p>
                  <p className="text-white/30 text-[10px] mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex border-t border-white/5">
            {(['about', 'streams', 'followers', 'following'] as ProfileTab[]).map((t) => {
              const icons: Record<ProfileTab, React.ReactNode> = {
                about:     <User className="w-3.5 h-3.5" />,
                streams:   <Radio className="w-3.5 h-3.5" />,
                followers: <Users className="w-3.5 h-3.5" />,
                following: <UserCheck className="w-3.5 h-3.5" />,
              };
              const counts: Record<ProfileTab, string | null> = {
                about:     null,
                streams:   null,
                followers: followStats.followers > 0 ? followStats.followers.toLocaleString() : null,
                following: followStats.following > 0 ? followStats.following.toLocaleString() : null,
              };
              return (
                <button key={t} onClick={() => setTab(t)}
                  className={cn('flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors border-b-2',
                    tab === t ? 'text-white border-rogan-500' : 'text-white/40 border-transparent hover:text-white')}>
                  {icons[t]}
                  <span>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
                  {counts[t] && <span className="text-white/30 text-[10px]">({counts[t]})</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab content */}
        <div className="bg-surface rounded-b-2xl border border-t-0 border-white/5">
          {contentLoading ? (
            <div className="py-8 flex justify-center">
              <div className="w-6 h-6 border-2 border-rogan-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : tab === 'about' ? (
            <div className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-white/30 text-sm">
                <Calendar className="w-4 h-4" />
                <span>Joined {profileUser.created_at ? new Date(profileUser.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'N/A'}</span>
              </div>
              {!profileUser.bio && <p className="text-white/20 text-sm italic">No bio yet.</p>}
            </div>
          ) : tab === 'streams' ? (
            streams.length === 0 ? (
              <p className="text-white/20 text-sm text-center py-8">No streams yet</p>
            ) : (
              <div className="divide-y divide-white/5">
                {streams.map((s) => (
                  <button key={s.id} onClick={() => onOpenStream?.(s.id)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-white/5 transition-colors text-left">
                    <div className="w-9 h-9 rounded-lg bg-rogan-600/20 flex items-center justify-center flex-shrink-0">
                      <Radio className={cn('w-4 h-4', s.is_live ? 'text-rogan-400' : 'text-white/30')} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{s.title}</p>
                      <p className="text-white/30 text-xs">{s.created_at ? timeAgo(s.created_at) : ''}{s.viewer_count > 0 && ` · ${s.viewer_count} viewers`}</p>
                    </div>
                    {s.is_live && <span className="bg-rogan-600/20 text-rogan-400 text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0">LIVE</span>}
                  </button>
                ))}
              </div>
            )
          ) : tab === 'followers' ? (
            followers.length === 0 ? (
              <p className="text-white/20 text-sm text-center py-8">No followers yet</p>
            ) : (
              <div className="divide-y divide-white/5">
                {followers.map((u) => <UserRow key={u.id} u={u} />)}
              </div>
            )
          ) : (
            following.length === 0 ? (
              <p className="text-white/20 text-sm text-center py-8">Not following anyone yet</p>
            ) : (
              <div className="divide-y divide-white/5">
                {following.map((u) => <UserRow key={u.id} u={u} />)}
              </div>
            )
          )}
        </div>

        <p className="text-white/20 text-xs text-center py-4">
          Joined {profileUser.created_at ? new Date(profileUser.created_at).toLocaleDateString() : '—'}
        </p>
      </div>
    </div>
  );
}
