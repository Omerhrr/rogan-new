'use client';

import { useState } from 'react';
import { X, Flag, AlertTriangle } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

interface ReportModalProps {
  open: boolean;
  onClose: () => void;
  streamId?: string;   // if reporting a stream
  userId?: string;     // if reporting a user
  targetName?: string; // display name / title for UX
}

const STREAM_REASONS = [
  'Nudity or sexual content',
  'Violence or graphic content',
  'Harassment or hate speech',
  'Spam or misleading',
  'Dangerous or illegal activity',
  'Minor in danger',
  'Other',
];

const USER_REASONS = [
  'Harassment or bullying',
  'Hate speech',
  'Spam or fake account',
  'Impersonation',
  'Threats or violence',
  'Underage user',
  'Other',
];

export default function ReportModal({ open, onClose, streamId, userId, targetName }: ReportModalProps) {
  const [selectedReason, setSelectedReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const isStream = Boolean(streamId);
  const reasons = isStream ? STREAM_REASONS : USER_REASONS;

  const handleClose = () => {
    setSelectedReason('');
    setCustomReason('');
    setDone(false);
    setError('');
    onClose();
  };

  const handleSubmit = async () => {
    const reason = selectedReason === 'Other' ? customReason.trim() : selectedReason;
    if (!reason) { setError('Please select or describe a reason.'); return; }

    setSubmitting(true);
    setError('');
    try {
      await api.post('/moderation/report', {
        target_type: isStream ? 'stream' : 'user',
        target_id: isStream ? streamId : userId,
        reason,
      });
      setDone(true);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative w-full max-w-sm bg-surface border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl z-10 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Flag className="w-4 h-4 text-red-400" />
            <h3 className="text-white font-semibold text-sm">
              Report {isStream ? 'Stream' : 'User'}
              {targetName && <span className="text-white/40 font-normal ml-1">— {targetName}</span>}
            </h3>
          </div>
          <button onClick={handleClose} className="text-white/40 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {done ? (
          <div className="px-5 py-10 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-green-400" />
            </div>
            <p className="text-white font-semibold">Report submitted</p>
            <p className="text-white/40 text-sm">Our moderation team will review it shortly.</p>
            <button
              onClick={handleClose}
              className="mt-2 px-6 py-2.5 bg-white/10 hover:bg-white/15 text-white rounded-xl text-sm transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            <p className="text-white/50 text-xs">Why are you reporting this {isStream ? 'stream' : 'user'}?</p>

            {/* Reason chips */}
            <div className="flex flex-wrap gap-2">
              {reasons.map((r) => (
                <button
                  key={r}
                  onClick={() => { setSelectedReason(r); setError(''); }}
                  className={cn(
                    'text-xs px-3 py-1.5 rounded-full border transition-colors',
                    selectedReason === r
                      ? 'bg-red-600/20 border-red-500/60 text-red-300'
                      : 'bg-white/5 border-white/10 text-white/60 hover:border-white/30 hover:text-white'
                  )}
                >
                  {r}
                </button>
              ))}
            </div>

            {/* Custom reason */}
            {selectedReason === 'Other' && (
              <textarea
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Describe the issue…"
                rows={3}
                maxLength={500}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 resize-none"
              />
            )}

            {error && <p className="text-red-400 text-xs">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={submitting || !selectedReason}
              className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition-colors"
            >
              {submitting ? 'Submitting…' : 'Submit Report'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
