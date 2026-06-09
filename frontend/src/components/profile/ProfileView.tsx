'use client';

import { useState, useEffect } from 'react';
import { User, Edit3, Save, X, Radio, Heart, Crown, MapPin, Calendar } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/use-mobile';
import api from '@/lib/api';
import { cn, formatCount, generateAvatar, timeAgo } from '@/lib/utils';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import type { User as UserType } from '@/types';

interface ProfileViewProps {
  userId: string | null;
}

export default function ProfileView({ userId }: ProfileViewProps) {
  const { user: currentUser, updateProfile } = useAuthStore();
  const isMobile = useIsMobile(960);
  const [profileUser, setProfileUser] = useState<UserType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const isOwnProfile = !userId || userId === currentUser?.id;

  useEffect(() => {
    if (isOwnProfile) {
      setProfileUser(currentUser);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    api.get(`/auth/users/${userId}`)
      .then((res) => setProfileUser(res.data))
      .catch(() => setProfileUser(null))
      .finally(() => setIsLoading(false));
  }, [userId, currentUser, isOwnProfile]);

  const startEditing = () => {
    setEditName(profileUser?.display_name || '');
    setEditBio(profileUser?.bio || '');
    setIsEditing(true);
  };

  const saveProfile = async () => {
    setIsSaving(true);
    try {
      await updateProfile({ display_name: editName, bio: editBio });
      setIsEditing(false);
    } catch {
      // Error handled by store
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <LoadingSpinner className="h-full" />;
  if (!profileUser) return (
    <div className="h-full flex items-center justify-center">
      <p className="text-white/40">User not found</p>
    </div>
  );

  return (
    <div className={cn('h-full overflow-y-auto scrollbar-thin', isMobile ? 'pb-24' : 'p-6')}>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Profile Header */}
        <div className="bg-surface rounded-2xl overflow-hidden border border-white/5">
          {/* Banner */}
          <div className="h-28 bg-gradient-to-r from-rogan-600/40 via-purple-600/30 to-blue-600/40" />

          {/* Avatar + Info */}
          <div className="px-6 pb-6">
            <div className="flex items-end gap-4 -mt-10 mb-4">
              <div className="w-20 h-20 rounded-full border-4 border-surface overflow-hidden bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
                {profileUser.avatar ? (
                  <img src={profileUser.avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  profileUser.username.charAt(0).toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-white text-xl font-bold truncate">
                  {profileUser.display_name || profileUser.username}
                </h1>
                <p className="text-white/40 text-sm">@{profileUser.username}</p>
              </div>
              {isOwnProfile && !isEditing && (
                <button onClick={startEditing} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/70 rounded-lg text-sm flex items-center gap-2 transition-colors">
                  <Edit3 className="w-4 h-4" /> Edit
                </button>
              )}
            </div>

            {/* Bio */}
            {isEditing ? (
              <div className="space-y-3 mb-4">
                <input type="text" placeholder="Display Name" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50" />
                <textarea placeholder="Bio" value={editBio} onChange={(e) => setEditBio(e.target.value)} rows={3} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 resize-none" />
                <div className="flex gap-2">
                  <button onClick={saveProfile} disabled={isSaving} className="px-4 py-2 bg-rogan-600 text-white text-sm rounded-lg flex items-center gap-2 disabled:opacity-50">
                    <Save className="w-4 h-4" /> {isSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={() => setIsEditing(false)} className="px-4 py-2 bg-white/5 text-white/60 text-sm rounded-lg flex items-center gap-2">
                    <X className="w-4 h-4" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              profileUser.bio && <p className="text-white/60 text-sm mb-4">{profileUser.bio}</p>
            )}

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white/5 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-white/40 text-xs mb-1">
                  <Radio className="w-3 h-3" /> Status
                </div>
                <p className={cn('text-sm font-medium', profileUser.is_live ? 'text-rogan-500' : 'text-white/60')}>
                  {profileUser.is_live ? 'LIVE' : 'Offline'}
                </p>
              </div>
              <div className="bg-white/5 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-white/40 text-xs mb-1">
                  <Crown className="w-3 h-3" /> Role
                </div>
                <p className="text-sm font-medium text-white/80 capitalize">{profileUser.role}</p>
              </div>
              <div className="bg-white/5 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-white/40 text-xs mb-1">
                  <Calendar className="w-3 h-3" /> Joined
                </div>
                <p className="text-sm font-medium text-white/80">
                  {profileUser.created_at ? new Date(profileUser.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'N/A'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
