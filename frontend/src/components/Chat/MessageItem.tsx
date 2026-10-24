import React, { useState } from 'react';
import { ChatMessage } from '../../types';
import { Bot, User, Brain, Wrench, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react';

interface MessageItemProps {
  message: ChatMessage;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message }) => {
  const isAssistant = message.role === 'assistant';
  const [thoughtsOpen, setThoughtsOpen] = useState(false);

  return (
    <div className={`flex gap-3 mb-4 ${isAssistant ? 'items-start' : 'items-start justify-end'}`}>
      {isAssistant && (
        <div className="w-8 h-8 rounded-full bg-m3-primary-container text-m3-on-primary-container flex items-center justify-center shrink-0 shadow-xs mt-0.5">
          <Bot className="w-4 h-4 text-m3-primary" />
        </div>
      )}

      <div className={`max-w-[85%] flex flex-col ${isAssistant ? 'items-start' : 'items-end'}`}>
        {/* Thoughts Accordion if present */}
        {isAssistant && message.thoughts && (
          <div className="w-full mb-2">
            <button
              onClick={() => setThoughtsOpen(!thoughtsOpen)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-m3-surface-container text-m3-on-surface-variant hover:bg-m3-surface-container-high transition-colors"
            >
              <Brain className="w-3.5 h-3.5 text-m3-secondary" />
              <span>Agent Thoughts</span>
              {thoughtsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            {thoughtsOpen && (
              <div className="mt-1.5 p-3 rounded-2xl bg-m3-surface-container-low text-xs text-m3-on-surface-variant font-mono whitespace-pre-wrap border border-m3-outline-variant/30 leading-relaxed">
                {message.thoughts}
              </div>
            )}
          </div>
        )}

        {/* Tool Call Badges if present */}
        {isAssistant && message.tool_calls && message.tool_calls.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {message.tool_calls.map((call, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-m3-surface-container-high text-m3-on-surface-variant border border-m3-outline-variant/30"
              >
                <Wrench className="w-3 h-3 text-m3-primary" />
                {call.name}
                <CheckCircle2 className="w-3 h-3 text-emerald-600 ml-0.5" />
              </span>
            ))}
          </div>
        )}

        {/* Message Bubble */}
        <div
          className={`p-4 rounded-3xl text-sm leading-relaxed ${
            isAssistant
              ? 'bg-m3-surface-container-low text-m3-on-surface border border-m3-outline-variant/30 shadow-2xs rounded-tl-sm'
              : 'bg-m3-primary text-m3-on-primary shadow-xs rounded-tr-sm'
          }`}
        >
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>

      {!isAssistant && (
        <div className="w-8 h-8 rounded-full bg-m3-secondary text-m3-on-primary flex items-center justify-center shrink-0 shadow-xs mt-0.5">
          <User className="w-4 h-4" />
        </div>
      )}
    </div>
  );
};
