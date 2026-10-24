import React from 'react';
import { User } from '../../types';
import { X, Shield, Users, Mail, CheckCircle2 } from 'lucide-react';

interface UserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
}

export const UserManagementModal: React.FC<UserManagementModalProps> = ({
  isOpen,
  onClose,
  currentUser,
}) => {
  if (!isOpen) return null;

  const demoUsers = [
    { id: 1, email: currentUser?.email || 'admin@antigravity.io', role: currentUser?.role || 'admin', status: 'Active' },
    { id: 2, email: 'dev.lead@example.com', role: 'member', status: 'Active' },
    { id: 3, email: 'data.analyst@example.com', role: 'member', status: 'Active' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="bg-m3-surface rounded-4xl max-w-xl w-full p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-m3-outline-variant/20">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-m3-primary-container text-m3-on-primary-container flex items-center justify-center">
              <Users className="w-5 h-5 text-m3-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold text-m3-on-surface">User & Identity Management</h2>
              <p className="text-xs text-m3-on-surface-variant">
                Manage workspace members, roles, and OIDC federated accounts.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User List */}
        <div className="flex flex-col gap-3 my-5">
          {demoUsers.map((u) => (
            <div
              key={u.id}
              className="p-4 rounded-3xl bg-m3-surface-container-low border border-m3-outline-variant/30 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-m3-surface-container-high flex items-center justify-center font-bold text-xs text-m3-primary">
                  {u.email[0].toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-m3-on-surface">{u.email}</span>
                    {u.id === currentUser?.id && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-m3-primary-container text-m3-on-primary-container font-semibold">
                        You
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-m3-on-surface-variant mt-0.5">
                    <Mail className="w-3 h-3" />
                    <span>OIDC Ready</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-m3-surface-container text-m3-on-surface-variant uppercase">
                  <Shield className="w-3 h-3 text-m3-secondary" />
                  {u.role}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                  <CheckCircle2 className="w-3 h-3" /> {u.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="p-3.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/20 text-xs text-m3-on-surface-variant flex items-center gap-2">
          <Shield className="w-4 h-4 text-m3-primary shrink-0" />
          <span>Single-Sign-On (SSO / OIDC) provider federation will map directory groups to these roles.</span>
        </div>

        <div className="flex justify-end pt-4 mt-2 border-t border-m3-outline-variant/20">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-90 transition-opacity"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
