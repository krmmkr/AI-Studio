import React, { useState } from 'react';
import { authApi } from '../../api/client';
import { User as UserType, AuthConfig, SystemBranding } from '../../types';
import { Lock, Mail, Loader2, ShieldCheck, ArrowRight, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { AIStudioLogo } from '../Common/AIStudioLogo';

interface LoginModalProps {
  authConfig?: AuthConfig | null;
  branding?: SystemBranding;
  onSuccess: (user: UserType) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ authConfig, branding, onSuccess }) => {
  const [email, setEmail] = useState('admin@antigravity.io');
  const [password, setPassword] = useState('antigravity123');
  const [loading, setLoading] = useState(false);
  const [ssoRedirecting, setSsoRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLocalLogin, setShowLocalLogin] = useState(false);

  // Default is true if authConfig is not yet loaded or if authConfig.auth is true
  const isAuthEnforced = authConfig?.auth !== false;
  const isOidcConfigured = Boolean(authConfig?.oidc_configured);

  const handleSsoClick = () => {
    setSsoRedirecting(true);
    const loginUrl = authConfig?.login_url || '/api/auth/oidc/login';
    window.location.href = loginUrl;
  };

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="bg-m3-surface rounded-4xl max-w-md w-full p-6 sm:p-8 shadow-2xl border border-m3-outline-variant/30 flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          <AIStudioLogo
            size="sm"
            showText={true}
            brandName={branding?.app_name}
            logoUrl={branding?.logo_url}
          />
        </div>

        {isAuthEnforced ? (
          <>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <ShieldCheck className="w-3 h-3" />
                SSO Enforced
              </span>
            </div>
            <h2 className="text-xl font-bold text-m3-on-surface tracking-tight mb-1">Single Sign-On (OIDC)</h2>
            <p className="text-xs text-m3-on-surface-variant mb-6">
              Authentication is required to access AI Studio workspaces, repositories, and connected agents.
            </p>

            {error && (
              <div className="mb-4 p-3 rounded-2xl bg-m3-error-container text-xs text-m3-error font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Primary SSO Action */}
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={handleSsoClick}
                disabled={ssoRedirecting}
                className="w-full py-3.5 px-4 rounded-2xl text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-95 transition-all shadow-md flex items-center justify-center gap-2 group cursor-pointer"
              >
                {ssoRedirecting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Connecting to Identity Provider...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Sign In with Single Sign-On (OIDC)</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform ml-auto" />
                  </>
                )}
              </button>

              {!isOidcConfigured && (
                <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] leading-relaxed">
                  <div className="font-semibold mb-0.5 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    OIDC Provider Setup
                  </div>
                  Configure <code>OIDC_ISSUER_URL</code> and <code>OIDC_CLIENT_ID</code> in your <code>.env</code> to connect your corporate IdP.
                </div>
              )}

              {/* Collapsible Local Admin Fallback */}
              <div className="mt-2 pt-2 border-t border-m3-outline-variant/20">
                <button
                  type="button"
                  onClick={() => setShowLocalLogin(!showLocalLogin)}
                  className="w-full flex items-center justify-between text-[11px] font-medium text-m3-on-surface-variant hover:text-m3-on-surface transition-colors py-1 cursor-pointer"
                >
                  <span>Emergency / Local Admin Fallback</span>
                  {showLocalLogin ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {showLocalLogin && (
                  <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-3 animate-in fade-in duration-200">
                    <div>
                      <label className="block text-[11px] font-semibold text-m3-on-surface mb-1">Email</label>
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/40 focus-within:border-m3-primary">
                        <Mail className="w-3.5 h-3.5 text-m3-on-surface-variant" />
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
                      <label className="block text-[11px] font-semibold text-m3-on-surface mb-1">Password</label>
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/40 focus-within:border-m3-primary">
                        <Lock className="w-3.5 h-3.5 text-m3-on-surface-variant" />
                        <input
                          type="password"
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full bg-transparent border-none outline-none text-xs text-m3-on-surface"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2.5 rounded-xl text-xs font-semibold bg-m3-surface-container-high hover:bg-m3-surface-container-highest text-m3-on-surface transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Log In with Password'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </>
        ) : (
          /* AUTH=false: Local Dev & Testing Mode (No SSO) */
          <>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Local Dev Mode (AUTH=false)
              </span>
            </div>
            <h2 className="text-xl font-bold text-m3-on-surface tracking-tight mb-1">Welcome to AI Studio</h2>
            <p className="text-xs text-m3-on-surface-variant mb-6">
              SSO is disabled for local dev and testing. Sign in directly with local credentials or click below.
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

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-3 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-95 transition-opacity shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enter Studio'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
