import React, { useState } from 'react';
import { authApi } from '../../api/client';
import { User as UserType } from '../../types';
import { Lock, Mail, Loader2 } from 'lucide-react';
import { AIStudioLogo } from '../Common/AIStudioLogo';

interface LoginModalProps {
  onSuccess: (user: UserType) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onSuccess }) => {
  const [email, setEmail] = useState('admin@antigravity.io');
  const [password, setPassword] = useState('antigravity123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setLoading(true);
      const res = await authApi.login(email, password);
      onSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
      <div className="bg-m3-surface rounded-4xl max-w-sm w-full p-6 sm:p-8 shadow-2xl border border-m3-outline-variant/30 flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          <AIStudioLogo size="sm" showText={true} />
        </div>

        <h2 className="text-xl font-bold text-m3-on-surface tracking-tight mb-1">Welcome back</h2>
        <p className="text-xs text-m3-on-surface-variant mb-6">
          Sign in to access your AI Studio agent, workspaces, and connected tools.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-2xl bg-m3-error-container text-xs text-m3-error font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-m3-on-surface mb-1">Email</label>
            <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 focus-within:border-m3-primary">
              <Mail className="w-4 h-4 text-m3-on-surface-variant" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-transparent border-none outline-none text-xs text-m3-on-surface"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-m3-on-surface mb-1">Password</label>
            <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 focus-within:border-m3-primary">
              <Lock className="w-4 h-4 text-m3-on-surface-variant" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent border-none outline-none text-xs text-m3-on-surface"
              />
            </div>
          </div>

          <p className="text-[11px] text-m3-on-surface-variant italic">
            * Default demo seed credentials pre-filled.
          </p>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-95 transition-opacity shadow-xs flex items-center justify-center gap-1.5"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enter Studio'}
          </button>
        </form>
      </div>
    </div>
  );
};
