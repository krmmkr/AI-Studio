import React, { useState, useEffect } from 'react';
import { User } from '../../types';
import { authApi } from '../../api/client';
import { X, Shield, Users, Mail, CheckCircle2, Plus, Trash2, Loader2 } from 'lucide-react';

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
  const [users, setUsers] = useState<Array<{ id: number; email: string; role: string; status: string; created_at?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'create'>('list');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'member' | 'admin'>('member');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const list = await authApi.listUsers();
      setUsers(list);
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to load workspace users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadUsers();
      setViewMode('list');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isAdmin = currentUser?.role === 'admin';

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    try {
      setSaving(true);
      setErrorMsg(null);
      await authApi.createUser({
        email: newEmail.trim(),
        password: newPassword.trim() || 'welcome123',
        role: newRole,
      });
      setNewEmail('');
      setNewPassword('');
      setNewRole('member');
      setViewMode('list');
      await loadUsers();
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (userId: number, role: string) => {
    try {
      setErrorMsg(null);
      await authApi.updateUserRole(userId, role);
      await loadUsers();
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to update role');
    }
  };

  const handleDeleteUser = async (userId: number, email: string) => {
    if (!window.confirm(`Remove user '${email}' from workspace?`)) return;
    try {
      setErrorMsg(null);
      await authApi.deleteUser(userId);
      await loadUsers();
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to delete user');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fadeIn">
      <div className="bg-m3-surface rounded-4xl w-[92vw] max-w-3xl h-[78vh] min-h-[540px] p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-m3-outline-variant/20 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-m3-primary-container text-m3-on-primary-container flex items-center justify-center">
              <Users className="w-5 h-5 text-m3-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold text-m3-on-surface">User & Identity Management</h2>
              <p className="text-xs text-m3-on-surface-variant">
                Manage workspace accounts, RBAC roles, and access permissions.
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

        {/* View Selector Dropdown & Action */}
        <div className="flex items-center justify-between gap-3 my-4 shrink-0">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-m3-on-surface-variant">View:</label>
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as 'list' | 'create')}
              className="px-3.5 py-2 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs font-semibold text-m3-on-surface outline-none focus:border-m3-primary cursor-pointer"
            >
              <option value="list">Workspace Members ({users.length})</option>
            </select>
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={() => setViewMode(viewMode === 'create' ? 'list' : 'create')}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary shadow-xs hover:opacity-90 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{viewMode === 'create' ? 'Back to Members' : 'Add User'}</span>
            </button>
          )}
        </div>

        {errorMsg && (
          <div className="mb-3 p-3 rounded-2xl bg-m3-error-container text-xs text-m3-error shrink-0">
            {errorMsg}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-xs text-m3-on-surface-variant gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-m3-primary" />
              <span>Loading users from database...</span>
            </div>
          ) : viewMode === 'create' && isAdmin ? (
            <form onSubmit={handleCreateUser} className="flex flex-col gap-3.5 max-w-lg">
              <div>
                <label className="block text-xs font-semibold text-m3-on-surface mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="engineer@organization.com"
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-m3-on-surface mb-1">Initial Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Defaults to welcome123 if left blank"
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-m3-on-surface mb-1">Workspace Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'member' | 'admin')}
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs font-semibold text-m3-on-surface outline-none focus:border-m3-primary"
                >
                  <option value="member">Member (Dashboards, SQL & Agent Access)</option>
                  <option value="admin">Admin (Full Global MCP, Dataset & User Control)</option>
                </select>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className="px-4 py-2 rounded-full text-xs font-semibold text-m3-on-surface-variant hover:bg-m3-surface-container"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary shadow-xs hover:opacity-90"
                >
                  {saving ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-2.5">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="p-4 rounded-3xl bg-m3-surface-container-low border border-m3-outline-variant/30 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-m3-surface-container-high flex items-center justify-center font-bold text-xs text-m3-primary">
                      {u.email[0]?.toUpperCase() || 'U'}
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
                        <span>ID #{u.id} • SQLite Identity Store</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isAdmin ? (
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        className="px-2.5 py-1 rounded-xl text-xs font-semibold bg-m3-surface-container border border-m3-outline-variant/30 text-m3-on-surface uppercase outline-none cursor-pointer"
                      >
                        <option value="admin">ADMIN</option>
                        <option value="member">MEMBER</option>
                      </select>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-m3-surface-container text-m3-on-surface-variant uppercase">
                        <Shield className="w-3 h-3 text-m3-secondary" />
                        {u.role}
                      </span>
                    )}

                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/15 px-2.5 py-1 rounded-full font-semibold">
                      <CheckCircle2 className="w-3 h-3" /> {u.status}
                    </span>

                    {isAdmin && u.id !== currentUser?.id && (
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(u.id, u.email)}
                        className="p-1.5 rounded-full text-m3-outline hover:text-m3-error hover:bg-m3-error-container/30 transition-colors cursor-pointer"
                        title="Delete user"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4 mt-3 border-t border-m3-outline-variant/20 shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-90 transition-opacity"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
