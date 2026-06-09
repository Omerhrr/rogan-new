'use client';

import { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, ArrowLeft, Clock } from 'lucide-react';
import { useDMStore } from '@/stores/dmStore';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn, timeAgo } from '@/lib/utils';
import EmptyState from '@/components/shared/EmptyState';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

export default function DMView() {
  const { conversations, currentConversation, messages, fetchConversations, fetchMessages, sendMessage, markAsRead, setCurrentConversation, isLoading } = useDMStore();
  const { user } = useAuthStore();
  const isMobile = useIsMobile(960);
  const [messageInput, setMessageInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  useEffect(() => {
    if (currentConversation) {
      fetchMessages(currentConversation.id);
      markAsRead(currentConversation.id);
    }
  }, [currentConversation, fetchMessages, markAsRead]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = async () => {
    if (!messageInput.trim() || !currentConversation) return;
    try {
      await sendMessage(currentConversation.id, messageInput.trim());
      setMessageInput('');
    } catch {}
  };

  const getOtherUser = (conv: typeof conversations[0]) => {
    if (!conv) return null;
    return conv.other_user || { username: 'Unknown' };
  };

  // Conversation List
  if (!currentConversation) {
    return (
      <div className={cn('h-full overflow-y-auto scrollbar-thin', isMobile ? 'pb-24' : 'p-6')}>
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-rogan-500" />
          Messages
        </h2>
        {isLoading ? <LoadingSpinner /> : conversations.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No Messages" description="Start a conversation by visiting a creator's profile" />
        ) : (
          <div className="space-y-1">
            {conversations.map((conv) => {
              const other = getOtherUser(conv);
              return (
                <button key={conv.id} onClick={() => setCurrentConversation(conv)} className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-white/5 transition-colors text-left">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                    {(other?.username || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-white text-sm font-medium">{other?.username || 'Unknown'}</span>
                      {conv.last_message?.created_at && <span className="text-white/30 text-[10px]">{timeAgo(conv.last_message.created_at)}</span>}
                    </div>
                    {conv.last_message && <p className="text-white/40 text-xs truncate">{conv.last_message.content}</p>}
                  </div>
                  {conv.unread_count > 0 && <span className="bg-rogan-600 text-white text-[10px] rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{conv.unread_count}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Chat View
  const other = getOtherUser(currentConversation);
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-14 flex items-center gap-3 px-4 border-b border-white/5 bg-surface">
        <button onClick={() => setCurrentConversation(null)} className="text-white/60 hover:text-white lg:hidden">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-xs font-bold">
          {(other?.username || 'U').charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-white text-sm font-medium">{other?.username || 'Unknown'}</p>
          {currentConversation.dm_price > 0 && <p className="text-tk text-[10px]">{currentConversation.dm_price} TK per message</p>}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
        {messages.map((msg) => {
          const isMine = msg.sender_id === user?.id;
          return (
            <div key={msg.id} className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[75%] rounded-2xl px-4 py-2', isMine ? 'bg-rogan-600 text-white' : 'bg-white/10 text-white/90')}>
                <p className="text-sm">{msg.content}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  {msg.is_paid && <span className="text-tk text-[10px]">{msg.amount_tk} TK</span>}
                  <span className="text-[10px] text-white/40">{msg.created_at ? timeAgo(msg.created_at) : ''}</span>
                  {isMine && msg.read_at && <span className="text-blue-400 text-[10px]">✓✓</span>}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-white/5 bg-surface">
        <div className="flex items-center gap-2">
          <input type="text" value={messageInput} onChange={(e) => setMessageInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder="Type a message..." className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50" />
          <button onClick={handleSend} disabled={!messageInput.trim()} className="w-10 h-10 rounded-full bg-rogan-600 flex items-center justify-center text-white disabled:opacity-30">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
