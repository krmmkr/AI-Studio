import React, { useState, useRef, useEffect } from 'react';
import { User } from '../types';
import { AIStudioLogo } from './Common/AIStudioLogo';
import {
  LogOut,
  Users,
  Database,
  ChevronDown,
  ChevronRight,
  Moon,
  Sun,
  Sliders,
  FolderGit2,
  User as UserIcon,
  Globe,
  Sparkles,
  Terminal,
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
      {/* Brand with Custom AI Studio Logo */}
      <button
        onClick={onNavigateHome}
        className="flex items-center gap-3 hover:opacity-85 transition-opacity text-left focus:outline-none group cursor-pointer"
        title="Go to AI Studio Workspaces (Homescreen)"
      >
        <AIStudioLogo size="md" showText={true} />
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
              className="flex items-center gap-2.5 p-1 pl-1.5 pr-3 rounded-full hover:bg-m3-surface-container transition-all border border-m3-outline-variant/30 bg-m3-surface-container-lowest shadow-2xs group cursor-pointer"
              title={`Signed in as ${user.email} (${user.role})`}
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-m3-primary to-m3-primary/80 text-m3-on-primary flex items-center justify-center font-bold text-xs shadow-xs group-hover:scale-105 transition-transform">
                {getInitials(user.email)}
              </div>
              <div className="hidden md:flex flex-col text-left">
                <span className="text-xs font-semibold text-m3-on-surface max-w-[120px] truncate leading-tight">
                  {user.email.split('@')[0]}
                </span>
                <span className="text-[10px] font-medium text-m3-on-surface-variant uppercase tracking-wider leading-tight">
                  {user.role}
                </span>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-m3-on-surface-variant transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Apache Superset 7.0 Style Expressive Spaced User Menu */}
            {dropdownOpen && (
              <div className="absolute right-0 mt-2.5 w-80 rounded-2xl bg-m3-surface p-2 shadow-2xl border border-m3-outline-variant/30 flex flex-col z-50 animate-fadeIn divide-y divide-m3-outline-variant/15 backdrop-blur-md">
                {/* 1. Superset User Profile Header Card */}
                <div className="p-3 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/25 mb-1.5">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-m3-primary to-m3-primary/80 text-m3-on-primary flex items-center justify-center font-bold text-sm shadow-xs ring-2 ring-m3-primary/20">
                        {getInitials(user.email)}
                      </div>
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-m3-surface" title="Active" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-sm font-semibold text-m3-on-surface truncate">
                          {user.email.split('@')[0]}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-m3-primary/15 text-m3-primary uppercase tracking-wide border border-m3-primary/20 shrink-0">
                          {user.role}
                        </span>
                      </div>
                      <p className="text-xs text-m3-on-surface-variant truncate mt-0.5" title={user.email}>
                        {user.email}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 2. Data & Analytics Section (Superset SQL Lab & Datasets) */}
                <div className="py-1.5 flex flex-col gap-0.5">
                  <div className="px-3 pt-1 pb-1 text-[10px] font-bold tracking-wider text-m3-on-surface-variant/70 uppercase">
                    Data & Analytics
                  </div>

                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      onOpenDuckDBConsole();
                    }}
                    className="flex items-center justify-between px-3 py-2 text-left rounded-xl hover:bg-m3-surface-container-high transition-colors group cursor-pointer w-full"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                        <Terminal className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-m3-on-surface group-hover:text-m3-primary transition-colors">
                          DuckDB SQL Console
                        </div>
                        <div className="text-[11px] text-m3-on-surface-variant truncate">
                          Fast in-process SQL queries & analytical tables
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-m3-on-surface-variant/40 group-hover:text-m3-on-surface-variant group-hover:translate-x-0.5 transition-all shrink-0 ml-2" />
                  </button>

                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      onOpenSettings();
                    }}
                    className="flex items-center justify-between px-3 py-2 text-left rounded-xl hover:bg-m3-surface-container-high transition-colors group cursor-pointer w-full"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                        <Database className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-m3-on-surface group-hover:text-m3-primary transition-colors">
                          Datasources Hub
                        </div>
                        <div className="text-[11px] text-m3-on-surface-variant truncate">
                          PostgreSQL, Snowflake, APIs & uploaded tables
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-m3-on-surface-variant/40 group-hover:text-m3-on-surface-variant group-hover:translate-x-0.5 transition-all shrink-0 ml-2" />
                  </button>

                  {onOpenRepoManager && (
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        onOpenRepoManager();
                      }}
                      className="flex items-center justify-between px-3 py-2 text-left rounded-xl hover:bg-m3-surface-container-high transition-colors group cursor-pointer w-full"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                          <FolderGit2 className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-m3-on-surface group-hover:text-m3-primary transition-colors">
                            Git Repositories
                          </div>
                          <div className="text-[11px] text-m3-on-surface-variant truncate">
                            Cloned repositories & codebase analysis
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-m3-on-surface-variant/40 group-hover:text-m3-on-surface-variant group-hover:translate-x-0.5 transition-all shrink-0 ml-2" />
                    </button>
                  )}
                </div>

                {/* 3. Studio & Customization Section */}
                <div className="py-1.5 flex flex-col gap-0.5">
                  <div className="px-3 pt-1 pb-1 text-[10px] font-bold tracking-wider text-m3-on-surface-variant/70 uppercase">
                    Studio Configuration
                  </div>

                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      onOpenAgentInstructions();
                    }}
                    className="flex items-center justify-between px-3 py-2 text-left rounded-xl hover:bg-m3-surface-container-high transition-colors group cursor-pointer w-full"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                        <Sliders className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-m3-on-surface group-hover:text-m3-primary transition-colors">
                          Agent Personas & Prompts
                        </div>
                        <div className="text-[11px] text-m3-on-surface-variant truncate">
                          System instructions & behavioral guidelines
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-m3-on-surface-variant/40 group-hover:text-m3-on-surface-variant group-hover:translate-x-0.5 transition-all shrink-0 ml-2" />
                  </button>

                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      onOpenUserManagement();
                    }}
                    className="flex items-center justify-between px-3 py-2 text-left rounded-xl hover:bg-m3-surface-container-high transition-colors group cursor-pointer w-full"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-cyan-500/10 text-cyan-500 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                        <Users className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-m3-on-surface group-hover:text-m3-primary transition-colors">
                          User & Access Management
                        </div>
                        <div className="text-[11px] text-m3-on-surface-variant truncate">
                          Manage members, roles & permissions
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-m3-on-surface-variant/40 group-hover:text-m3-on-surface-variant group-hover:translate-x-0.5 transition-all shrink-0 ml-2" />
                  </button>
                </div>

                {/* 4. Session Actions */}
                <div className="pt-1.5 flex flex-col gap-1">
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      onLogout();
                    }}
                    className="flex items-center justify-between px-3 py-2.5 text-left rounded-xl hover:bg-m3-error-container/30 transition-colors group cursor-pointer w-full text-m3-error"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-m3-error-container/40 text-m3-error flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                        <LogOut className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold">Sign Out</div>
                        <div className="text-[11px] opacity-80 truncate">
                          End current session securely
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
