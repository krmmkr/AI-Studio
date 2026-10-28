import React, { useState, useEffect } from 'react';
import { User } from '../../types';
import { userApi, UserSettings, getAuthToken } from '../../api/client';
import {
  X,
  Shield,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  GitBranch,
  Globe,
  Sparkles,
  Lock,
} from 'lucide-react';

interface UserSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
}

export const UserSettingsModal: React.FC<UserSettingsModalProps> = ({
  isOpen,
  onClose,
  currentUser,
}) => {
  const [activeTab, setActiveTab] = useState<'integrations' | 'byok' | 'git' | 'security'>('integrations');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [settings, setSettings] = useState<UserSettings | null>(null);

  // Form states
  const [gitName, setGitName] = useState('');
  const [gitEmail, setGitEmail] = useState('');

  // GitHub Form
  const [githubToken, setGithubToken] = useState('');
  const [githubUsername, setGithubUsername] = useState('');
  const [showGithubToken, setShowGithubToken] = useState(false);

  // Jira Form
  const [jiraUrl, setJiraUrl] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');
  const [showJiraToken, setShowJiraToken] = useState(false);
  const [showJiraManual, setShowJiraManual] = useState(false);
  const [showGithubManual, setShowGithubManual] = useState(false);

  // AI Provider BYOK Form
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});

  // Password change Form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const data = await userApi.getSettings();
      setSettings(data);

      // Populate form fields
      setGitName(data.git.name || '');
      setGitEmail(data.git.email || '');

      setGithubUsername(data.integrations.github.username || '');
      setGithubToken(data.integrations.github.has_token ? (data.integrations.github.masked_token || '') : '');

      setJiraUrl(data.integrations.jira.url || '');
      setJiraEmail(data.integrations.jira.email || '');
      setJiraToken(data.integrations.jira.has_token ? (data.integrations.jira.masked_token || '') : '');

      setAnthropicKey(data.integrations.byok.anthropic.has_key ? (data.integrations.byok.anthropic.masked_key || '') : '');
      setOpenaiKey(data.integrations.byok.openai.has_key ? (data.integrations.byok.openai.masked_key || '') : '');
      setDeepseekKey(data.integrations.byok.deepseek.has_key ? (data.integrations.byok.deepseek.masked_key || '') : '');
      setGeminiKey(data.integrations.byok.gemini.has_key ? (data.integrations.byok.gemini.masked_key || '') : '');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load user settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadSettings();
      setSuccessMsg(null);
      setErrorMsg(null);
    }
  }, [isOpen]);

  // Listen for OAuth completion messages from popup windows
  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === 'oauth_success') {
        setSuccessMsg(`Successfully connected to ${event.data.provider === 'atlassian' ? 'Atlassian Jira' : 'GitHub'} via browser OAuth!`);
        loadSettings();
      } else if (event.data?.type === 'oauth_error') {
        setErrorMsg(event.data.error || 'OAuth authorization failed');
      }
    };
    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, []);

  if (!isOpen) return null;

  const toggleKeyVisibility = (provider: string) => {
    setVisibleKeys((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  const handleOpenOAuthPopup = (url: string, title: string) => {
    const token = getAuthToken();
    const finalUrl = token ? `${url}?token=${encodeURIComponent(token)}` : url;
    const w = 620;
    const h = 700;
    const left = window.screen.width / 2 - w / 2;
    const top = window.screen.height / 2 - h / 2;
    window.open(
      finalUrl,
      title,
      `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=yes, resizable=yes, copyhistory=no, width=${w}, height=${h}, top=${top}, left=${left}`
    );
  };

  const handleDisconnectOAuth = async (provider: 'atlassian' | 'github') => {
    if (!confirm(`Are you sure you want to disconnect ${provider === 'atlassian' ? 'Atlassian Jira' : 'GitHub'}?`)) return;
    try {
      setSaving(true);
      await userApi.disconnectOAuth(provider);
      setSuccessMsg(`Disconnected ${provider === 'atlassian' ? 'Atlassian Jira' : 'GitHub'}.`);
      await loadSettings();
    } catch (e: any) {
      setErrorMsg(e.message || `Failed to disconnect ${provider}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      setSaving(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      await userApi.updateSettings({
        git_name: gitName,
        git_email: gitEmail,
        github_token: githubToken,
        github_username: githubUsername,
        jira_url: jiraUrl,
        jira_email: jiraEmail,
        jira_token: jiraToken,
        anthropic_api_key: anthropicKey,
        openai_api_key: openaiKey,
        deepseek_api_key: deepseekKey,
        gemini_api_key: geminiKey,
      });

      setSuccessMsg('Settings and credentials saved successfully (encrypted at rest).');
      await loadSettings();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update user settings');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setErrorMsg('New passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setErrorMsg('New password must be at least 6 characters');
      return;
    }
    try {
      setChangingPassword(true);
      setErrorMsg(null);
      await userApi.changePassword(currentPassword, newPassword);
      setSuccessMsg('Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to update password');
    } finally {
      setChangingPassword(false);
    }
  };

  const jiraConnected = settings?.integrations.jira.has_token;
  const githubConnected = settings?.integrations.github.has_token;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="w-full max-w-2xl bg-m3-surface rounded-2xl shadow-2xl border border-m3-outline-variant/30 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-m3-outline-variant/20 bg-m3-surface-container-low/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-m3-on-surface">User Settings & Integrations</h2>
              <p className="text-xs text-m3-on-surface-variant">
                Manage personal tokens, Git commit signature, and browser OAuth connectors.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-m3-surface-container-high text-m3-on-surface-variant hover:text-m3-on-surface transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-m3-outline-variant/15 bg-m3-surface shrink-0 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('integrations')}
            className={`flex items-center gap-2 px-3 py-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'integrations'
                ? 'border-indigo-500 text-indigo-400 font-bold'
                : 'border-transparent text-m3-on-surface-variant hover:text-m3-on-surface'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Connected Services (Jira & GitHub)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('byok')}
            className={`flex items-center gap-2 px-3 py-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'byok'
                ? 'border-indigo-500 text-indigo-400 font-bold'
                : 'border-transparent text-m3-on-surface-variant hover:text-m3-on-surface'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Provider Keys (BYOK)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('git')}
            className={`flex items-center gap-2 px-3 py-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'git'
                ? 'border-indigo-500 text-indigo-400 font-bold'
                : 'border-transparent text-m3-on-surface-variant hover:text-m3-on-surface'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Git Signature</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('security')}
            className={`flex items-center gap-2 px-3 py-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'security'
                ? 'border-indigo-500 text-indigo-400 font-bold'
                : 'border-transparent text-m3-on-surface-variant hover:text-m3-on-surface'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Security & Password</span>
          </button>
        </div>

        {/* Feedback Alerts */}
        {errorMsg && (
          <div className="mx-6 mt-3 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="mx-6 mt-3 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-m3-on-surface-variant">
              <Loader2 className="w-6 h-6 animate-spin text-m3-primary" />
              <span className="text-xs">Loading encrypted settings...</span>
            </div>
          ) : activeTab === 'integrations' ? (
            <div className="space-y-6">
              {/* Atlassian Jira & Confluence Card */}
              <div className="p-4 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/15 text-blue-400 flex items-center justify-center font-bold text-xs">
                      Jira
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-m3-on-surface">Atlassian Jira & Confluence MCP</h3>
                      <p className="text-[11px] text-m3-on-surface-variant">
                        Connect to Jira cloud to query issues, track sprints, and read project tickets.
                      </p>
                    </div>
                  </div>
                  {jiraConnected ? (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      <CheckCircle2 className="w-3 h-3" />
                      Connected ({settings?.integrations.jira.auth_type === 'oauth' ? 'OAuth' : 'API Token'})
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-500/15 text-zinc-400 border border-zinc-500/30">
                      Not Connected
                    </span>
                  )}
                </div>

                {jiraConnected && (
                  <div className="p-2.5 rounded-xl bg-m3-surface border border-m3-outline-variant/20 flex items-center justify-between text-xs">
                    <div className="space-y-0.5 min-w-0 pr-2">
                      <div className="font-mono text-[11px] text-m3-on-surface truncate">
                        {settings?.integrations.jira.url || 'Atlassian Cloud'}
                      </div>
                      {settings?.integrations.jira.cloud_id && (
                        <div className="text-[10px] text-m3-outline font-mono truncate">
                          Cloud ID: {settings.integrations.jira.cloud_id}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDisconnectOAuth('atlassian')}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-500/10 border border-rose-500/30 transition-colors cursor-pointer shrink-0"
                    >
                      Disconnect
                    </button>
                  </div>
                )}

                {/* Primary: Browser OAuth button */}
                <div className="pt-1 flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenOAuthPopup('/api/user/oauth/atlassian/login', 'Connect Atlassian Jira')}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>Connect with Atlassian (Browser 1-Click)</span>
                    <ExternalLink className="w-3 h-3 opacity-70" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowJiraManual(!showJiraManual)}
                    className="px-3 py-2 rounded-xl bg-m3-surface hover:bg-m3-surface-container border border-m3-outline-variant/30 text-xs text-m3-on-surface-variant hover:text-m3-on-surface transition-colors cursor-pointer"
                  >
                    {showJiraManual ? 'Hide API Token Option' : 'Or use API Token'}
                  </button>
                </div>

                {/* Manual Fallback for On-Prem / Self-Hosted Jira */}
                {showJiraManual && (
                  <div className="pt-2 border-t border-m3-outline-variant/20 space-y-2 text-xs animate-fadeIn">
                    <div className="text-[10px] text-m3-on-surface-variant font-medium">
                      Self-Hosted Jira Server or Direct Cloud API Token:
                    </div>
                    <div>
                      <label className="block text-[10px] text-m3-outline mb-1 font-mono uppercase">
                        Jira Base URL
                      </label>
                      <input
                        type="text"
                        value={jiraUrl}
                        onChange={(e) => setJiraUrl(e.target.value)}
                        placeholder="https://your-domain.atlassian.net"
                        className="w-full px-3 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-xs text-m3-on-surface placeholder:text-m3-outline outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-m3-outline mb-1 font-mono uppercase">
                        Account Email
                      </label>
                      <input
                        type="email"
                        value={jiraEmail}
                        onChange={(e) => setJiraEmail(e.target.value)}
                        placeholder="alice@company.com"
                        className="w-full px-3 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-xs text-m3-on-surface placeholder:text-m3-outline outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-m3-outline mb-1 font-mono uppercase">
                        Jira API Token
                      </label>
                      <div className="relative">
                        <input
                          type={showJiraToken ? 'text' : 'password'}
                          value={jiraToken}
                          onChange={(e) => setJiraToken(e.target.value)}
                          placeholder="Paste Jira API Token"
                          className="w-full pl-3 pr-8 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 font-mono text-xs text-m3-on-surface placeholder:text-m3-outline outline-none focus:border-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowJiraToken(!showJiraToken)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-m3-outline hover:text-m3-on-surface"
                        >
                          {showJiraToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* GitHub Service Card */}
              <div className="p-4 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-purple-500/15 text-purple-400 flex items-center justify-center font-bold text-xs">
                      Git
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-m3-on-surface">GitHub Integration</h3>
                      <p className="text-[11px] text-m3-on-surface-variant">
                        Authenticate git clones, automated branch pushes, and pull request creation.
                      </p>
                    </div>
                  </div>
                  {githubConnected ? (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      <CheckCircle2 className="w-3 h-3" />
                      Connected ({settings?.integrations.github.username ? `@${settings.integrations.github.username}` : 'PAT'})
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-500/15 text-zinc-400 border border-zinc-500/30">
                      Not Connected
                    </span>
                  )}
                </div>

                {githubConnected && (
                  <div className="p-2.5 rounded-xl bg-m3-surface border border-m3-outline-variant/20 flex items-center justify-between text-xs">
                    <div className="space-y-0.5 min-w-0 pr-2">
                      <div className="font-mono text-[11px] text-m3-on-surface truncate">
                        {settings?.integrations.github.username ? `@${settings.integrations.github.username}` : 'Personal Access Token'}
                      </div>
                      <div className="text-[10px] text-m3-outline font-mono truncate">
                        Token: {settings?.integrations.github.masked_token}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDisconnectOAuth('github')}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-500/10 border border-rose-500/30 transition-colors cursor-pointer shrink-0"
                    >
                      Disconnect
                    </button>
                  </div>
                )}

                <div className="pt-1 flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenOAuthPopup('/api/user/oauth/github/login', 'Connect GitHub')}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>Connect with GitHub (Browser 1-Click)</span>
                    <ExternalLink className="w-3 h-3 opacity-70" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowGithubManual(!showGithubManual)}
                    className="px-3 py-2 rounded-xl bg-m3-surface hover:bg-m3-surface-container border border-m3-outline-variant/30 text-xs text-m3-on-surface-variant hover:text-m3-on-surface transition-colors cursor-pointer"
                  >
                    {showGithubManual ? 'Hide PAT Option' : 'Or use GitHub PAT'}
                  </button>
                </div>

                {showGithubManual && (
                  <div className="pt-2 border-t border-m3-outline-variant/20 space-y-2 text-xs animate-fadeIn">
                    <div>
                      <label className="block text-[10px] text-m3-outline mb-1 font-mono uppercase">
                        GitHub Username
                      </label>
                      <input
                        type="text"
                        value={githubUsername}
                        onChange={(e) => setGithubUsername(e.target.value)}
                        placeholder="e.g. octocat"
                        className="w-full px-3 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-xs text-m3-on-surface placeholder:text-m3-outline outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-m3-outline mb-1 font-mono uppercase">
                        Personal Access Token (PAT)
                      </label>
                      <div className="relative">
                        <input
                          type={showGithubToken ? 'text' : 'password'}
                          value={githubToken}
                          onChange={(e) => setGithubToken(e.target.value)}
                          placeholder="ghp_••••••••••••••••••••••••••••••••••••"
                          className="w-full pl-3 pr-8 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 font-mono text-xs text-m3-on-surface placeholder:text-m3-outline outline-none focus:border-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowGithubToken(!showGithubToken)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-m3-outline hover:text-m3-on-surface"
                        >
                          {showGithubToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <p className="text-[10px] text-m3-outline mt-1">
                        Requires GitHub scopes: <code className="font-mono">repo</code>, <code className="font-mono">read:org</code>.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'byok' ? (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-300">
                <span className="font-bold">Bring Your Own Key (BYOK):</span> Configure personal provider API keys to use your own account quotas and billing. User keys take immediate priority over system environment variables.
              </div>

              {/* DeepSeek API Key */}
              <div className="p-3.5 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/25 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-m3-on-surface">DeepSeek API Key</span>
                  {settings?.integrations.byok.deepseek.has_key && (
                    <span className="text-[10px] text-emerald-400 font-mono">Configured (Encrypted)</span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={visibleKeys['deepseek'] ? 'text' : 'password'}
                    value={deepseekKey}
                    onChange={(e) => setDeepseekKey(e.target.value)}
                    placeholder="dsk-••••••••••••••••••••••••••••••••"
                    className="w-full pl-3 pr-8 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 font-mono text-xs text-m3-on-surface placeholder:text-m3-outline outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => toggleKeyVisibility('deepseek')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-m3-outline hover:text-m3-on-surface"
                  >
                    {visibleKeys['deepseek'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Anthropic Claude API Key */}
              <div className="p-3.5 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/25 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-m3-on-surface">Anthropic Claude API Key</span>
                  {settings?.integrations.byok.anthropic.has_key && (
                    <span className="text-[10px] text-emerald-400 font-mono">Configured (Encrypted)</span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={visibleKeys['anthropic'] ? 'text' : 'password'}
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    placeholder="sk-ant-••••••••••••••••••••••••••••••••"
                    className="w-full pl-3 pr-8 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 font-mono text-xs text-m3-on-surface placeholder:text-m3-outline outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => toggleKeyVisibility('anthropic')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-m3-outline hover:text-m3-on-surface"
                  >
                    {visibleKeys['anthropic'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* OpenAI API Key */}
              <div className="p-3.5 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/25 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-m3-on-surface">OpenAI API Key</span>
                  {settings?.integrations.byok.openai.has_key && (
                    <span className="text-[10px] text-emerald-400 font-mono">Configured (Encrypted)</span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={visibleKeys['openai'] ? 'text' : 'password'}
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder="sk-proj-••••••••••••••••••••••••••••••••"
                    className="w-full pl-3 pr-8 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 font-mono text-xs text-m3-on-surface placeholder:text-m3-outline outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => toggleKeyVisibility('openai')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-m3-outline hover:text-m3-on-surface"
                  >
                    {visibleKeys['openai'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Google Gemini API Key */}
              <div className="p-3.5 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/25 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-m3-on-surface">Google Gemini API Key</span>
                  {settings?.integrations.byok.gemini.has_key && (
                    <span className="text-[10px] text-emerald-400 font-mono">Configured (Encrypted)</span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={visibleKeys['gemini'] ? 'text' : 'password'}
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="AIza••••••••••••••••••••••••••••••••"
                    className="w-full pl-3 pr-8 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 font-mono text-xs text-m3-on-surface placeholder:text-m3-outline outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => toggleKeyVisibility('gemini')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-m3-outline hover:text-m3-on-surface"
                  >
                    {visibleKeys['gemini'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          ) : activeTab === 'git' ? (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-300">
                <span className="font-bold">Git Commit Attribution:</span> Configures the <code className="font-mono">user.name</code> and <code className="font-mono">user.email</code> author signatures used when Code Studio commits code and opens pull requests.
              </div>

              <div>
                <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={gitName}
                  onChange={(e) => setGitName(e.target.value)}
                  placeholder="e.g. Alice Smith"
                  className="w-full px-3 py-2 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-xs text-m3-on-surface placeholder:text-m3-outline outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                  Commit Email Address
                </label>
                <input
                  type="email"
                  value={gitEmail}
                  onChange={(e) => setGitEmail(e.target.value)}
                  placeholder="alice@company.com"
                  className="w-full px-3 py-2 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-xs text-m3-on-surface placeholder:text-m3-outline outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Account Overview */}
              <div className="p-3.5 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/25 flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-m3-on-surface">{currentUser?.email}</div>
                  <div className="text-[11px] text-m3-outline">Role: {currentUser?.role || 'member'}</div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/15 text-indigo-400">
                  Active Session
                </span>
              </div>

              {/* Change Password Form */}
              <form onSubmit={handleChangePasswordSubmit} className="space-y-3 pt-2">
                <h3 className="text-xs font-bold text-m3-on-surface uppercase tracking-wider">
                  Change Password
                </h3>
                <div>
                  <label className="block text-xs text-m3-on-surface-variant mb-1">
                    Current Password
                  </label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    className="w-full px-3 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-xs text-m3-on-surface outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-m3-on-surface-variant mb-1">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                    className="w-full px-3 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-xs text-m3-on-surface outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-m3-on-surface-variant mb-1">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                    className="w-full px-3 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-xs text-m3-on-surface outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={changingPassword}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {changingPassword && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Update Password</span>
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-m3-outline-variant/20 bg-m3-surface-container-low/60 shrink-0">
          <div className="flex items-center gap-1.5 text-[11px] text-m3-outline">
            <Lock className="w-3.5 h-3.5 text-indigo-400" />
            <span>Encrypted at rest with AES-256 (Fernet)</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl hover:bg-m3-surface-container text-xs font-semibold text-m3-on-surface-variant hover:text-m3-on-surface transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => handleSaveSettings()}
              disabled={saving || loading}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-xs hover:shadow-sm disabled:opacity-50 transition-all cursor-pointer"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Save Changes</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
