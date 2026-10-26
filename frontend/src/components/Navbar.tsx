import React, { useState, useRef, useEffect } from 'react';
import { User } from '../types';
import {
  LogOut,
  Users,
  Database,
  ChevronDown,
  Moon,
  Sun,
  Sliders,
  FolderGit2,
  User as UserIcon,
  Globe,
  Sparkles,
} from 'lucide-react';

interface NavbarProps {
  user: User | null;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onNavigateHome?: () => void;
  activeTab?: 'chat' | 'my' | 'public';
  onSelectTab?: (tab: 'chat' | 'my' | 'public') => void;
  workspaceScope?: 'my' | 'public';
  onSelectWorkspaceScope?: (scope: 'my' | 'public') => void;
  onOpenSettings: () => void;
  onOpenAgentInstructions: () => void;
  onOpenRepoManager?: () => void;
  onOpenUserManagement: () => void;
  onOpenDuckDBConsole: () => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  darkMode,
  onToggleDarkMode,
  onNavigateHome,
  activeTab,
  onSelectTab,
  workspaceScope = 'my',
  onSelectWorkspaceScope,
  onOpenSettings,
  onOpenAgentInstructions,
  onOpenRepoManager,
  onOpenUserManagement,
  onOpenDuckDBConsole,
  onLogout,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getInitials = (email: string) => {
    return email ? email[0].toUpperCase() : 'U';
  };

  const isChatActive = activeTab === 'chat';
  const isMyActive = activeTab ? activeTab === 'my' : workspaceScope === 'my';
  const isPublicActive = activeTab ? activeTab === 'public' : workspaceScope === 'public';

  return (
    <header className="h-16 px-4 sm:px-6 bg-m3-surface-container-low border-b border-m3-outline-variant/30 flex items-center justify-between shrink-0 z-30 transition-colors">
      {/* Brand with Custom Antigravity Orbital Ring Glyph */}
      <button
        onClick={onNavigateHome}
        className="flex items-center gap-3 hover:opacity-85 transition-opacity text-left focus:outline-none group"
        title="Go to Dashboard Workspaces (Homescreen)"
      >
        <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-m3-primary to-m3-secondary flex items-center justify-center text-white shadow-xs group-hover:scale-105 transition-transform">
          <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="4" fill="currentColor" />
            <path
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"
              opacity="0.4"
            />
            <path d="M12 5a7 7 0 0 1 7 7h2a9 9 0 0 0-9-9v2z" />
          </svg>
        </div>
        <div>
          <h1 className="font-bold text-sm sm:text-base tracking-tight text-m3-on-surface">
            Antigravity Studio
          </h1>
        </div>
      </button>

      {/* Center: Top Workspace Menu (Agentic Chat vs My Workspace vs Public Workspace) */}
      {(onSelectTab || onSelectWorkspaceScope) && (
        <div className="flex items-center p-1 bg-m3-surface-container rounded-full shadow-2xs">
          {/* Tab 1: Agentic Chat (First Tab) */}
          <button
            onClick={() => (onSelectTab ? onSelectTab('chat') : undefined)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              isChatActive
                ? 'bg-m3-primary text-m3-on-primary shadow-xs'
                : 'text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container-high'
            }`}
            title="Chat directly with connected MCP agents without creating charts"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Agentic Chat</span>
          </button>

          {/* Tab 2: My Workspace */}
          <button
            onClick={() => {
              if (onSelectTab) onSelectTab('my');
              else if (onSelectWorkspaceScope) onSelectWorkspaceScope('my');
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              isMyActive
                ? 'bg-m3-primary text-m3-on-primary shadow-xs'
                : 'text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container-high'
            }`}
            title="My personal workspaces and dashboards"
          >
            <UserIcon className="w-3.5 h-3.5" />
            <span>My Workspace</span>
          </button>

          {/* Tab 3: Public Workspace */}
          <button
            onClick={() => {
              if (onSelectTab) onSelectTab('public');
              else if (onSelectWorkspaceScope) onSelectWorkspaceScope('public');
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              isPublicActive
                ? 'bg-m3-primary text-m3-on-primary shadow-xs'
                : 'text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container-high'
            }`}
            title="Public dashboards created and shared by others"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Public Workspace</span>
          </button>
        </div>
      )}

      {/* Right Controls */}
      <div className="flex items-center gap-2">
        {/* Dark Theme Toggle Button */}
        <button
          onClick={onToggleDarkMode}
          className="p-2 rounded-full text-m3-on-surface-variant hover:bg-m3-surface-container-high transition-colors"
          title={darkMode ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
        >
          {darkMode ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-m3-secondary" />}
        </button>

        {/* Circular User Avatar with Dropdown */}
        {user && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 p-1 pl-1.5 pr-2.5 rounded-full hover:bg-m3-surface-container-high transition-all border border-m3-outline-variant/30 bg-m3-surface-container-lowest shadow-2xs group"
            >
              <div className="w-8 h-8 rounded-full bg-m3-primary text-m3-on-primary flex items-center justify-center font-bold text-xs shadow-xs group-hover:scale-105 transition-transform">
                {getInitials(user.email)}
              </div>
              <span className="hidden md:inline text-xs font-medium text-m3-on-surface max-w-[120px] truncate">
                {user.email.split('@')[0]}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-m3-on-surface-variant" />
            </button>

            {/* Material 3 Expressive Dropdown Menu (Clean, No Subtext) */}
            {dropdownOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-m3-surface p-1.5 shadow-xl border border-m3-outline-variant/30 flex flex-col gap-0.5 animate-fadeIn z-50">
                {/* User Header Details */}
                <div className="px-3 py-2 rounded-xl bg-m3-surface-container-low mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-m3-on-surface truncate max-w-[140px]">{user.email}</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-m3-primary-container text-m3-on-primary-container uppercase">
                    {user.role}
                  </span>
                </div>

                {/* Dropdown Action Items */}
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    onOpenAgentInstructions();
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-m3-on-surface rounded-xl hover:bg-m3-surface-container-high transition-colors text-left"
                >
                  <Sliders className="w-4 h-4 text-m3-primary shrink-0" />
                  <span>Agent Instructions</span>
                </button>

                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    onOpenSettings();
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-m3-on-surface rounded-xl hover:bg-m3-surface-container-high transition-colors text-left"
                >
                  <Database className="w-4 h-4 text-m3-primary shrink-0" />
                  <span>Datasources Hub</span>
                </button>

                {onOpenRepoManager && (
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      onOpenRepoManager();
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-m3-on-surface rounded-xl hover:bg-m3-surface-container-high transition-colors text-left"
                  >
                    <FolderGit2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>Repositories</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    onOpenDuckDBConsole();
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-m3-on-surface rounded-xl hover:bg-m3-surface-container-high transition-colors text-left"
                >
                  <Database className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>DuckDB Analytics</span>
                </button>

                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    onOpenUserManagement();
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-m3-on-surface rounded-xl hover:bg-m3-surface-container-high transition-colors text-left"
                >
                  <Users className="w-4 h-4 text-m3-tertiary shrink-0" />
                  <span>User Management</span>
                </button>

                <div className="h-px bg-m3-outline-variant/20 my-1 mx-1.5" />

                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    onLogout();
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-m3-error rounded-xl hover:bg-m3-error-container/30 transition-colors text-left"
                >
                  <LogOut className="w-4 h-4 shrink-0" />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
