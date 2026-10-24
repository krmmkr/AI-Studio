import React, { useState } from 'react';
import { AgentPersona } from '../../types';
import { agentApi } from '../../api/client';
import { X, Bot, Save, CheckCircle, Plus, Trash2, GitPullRequest, BarChart3, Code2 } from 'lucide-react';

interface AgentInstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  personas: AgentPersona[];
  onPersonasRefreshed: () => void;
}

export const AgentInstructionsModal: React.FC<AgentInstructionsModalProps> = ({
  isOpen,
  onClose,
  personas,
  onPersonasRefreshed,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(personas[0]?.id || 'github-agent');
  const [instructions, setInstructions] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // New agent form
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentRole, setNewAgentRole] = useState('');
  const [newAgentPrompt, setNewAgentPrompt] = useState('');

  const selectedPersona = personas.find((p) => p.id === selectedAgentId) || personas[0];

  React.useEffect(() => {
    if (selectedPersona) {
      setInstructions(selectedPersona.system_instructions);
      setSavedSuccess(false);
    }
  }, [selectedAgentId, selectedPersona]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!selectedPersona) return;
    try {
      setSaving(true);
      await agentApi.updateInstructions(selectedPersona.id, instructions);
      setSavedSuccess(true);
      onPersonasRefreshed();
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (e) {
      console.error(e);
      alert('Failed to save instructions');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentName || !newAgentPrompt) return;

    try {
      setSaving(true);
      const res = await agentApi.createPersona({
        name: newAgentName,
        role_description: newAgentRole || 'Specialized AI development assistant.',
        system_instructions: newAgentPrompt,
      });
      setNewAgentName('');
      setNewAgentRole('');
      setNewAgentPrompt('');
      setIsCreating(false);
      onPersonasRefreshed();
      setSelectedAgentId(res.id);
    } catch (e: any) {
      alert(e.message || 'Failed to create agent');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAgent = async (agentId: string) => {
    if (!confirm('Are you sure you want to delete this custom agent?')) return;
    try {
      await agentApi.deletePersona(agentId);
      onPersonasRefreshed();
      setSelectedAgentId('github-agent');
    } catch (e: any) {
      alert(e.message || 'Failed to delete agent');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-m3-surface rounded-4xl max-w-3xl w-full p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-m3-outline-variant/20 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-m3-primary-container text-m3-on-primary-container flex items-center justify-center">
              <Bot className="w-5 h-5 text-m3-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold text-m3-on-surface">Agent Personas & Instructions</h2>
              <p className="text-xs text-m3-on-surface-variant">
                Configure specialized prompt behaviors or create custom domain agents.
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

        {/* Tab & Action Bar */}
        <div className="flex items-center justify-between gap-2 my-4 flex-wrap">
          <div className="flex gap-1.5 bg-m3-surface-container-low p-1.5 rounded-full flex-wrap">
            {personas.map((persona) => (
              <button
                key={persona.id}
                onClick={() => {
                  setSelectedAgentId(persona.id);
                  setIsCreating(false);
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  selectedAgentId === persona.id && !isCreating
                    ? 'bg-m3-primary text-m3-on-primary shadow-xs'
                    : 'text-m3-on-surface-variant hover:text-m3-on-surface'
                }`}
              >
                {persona.id === 'github-agent' ? (
                  <GitPullRequest className="w-3.5 h-3.5" />
                ) : persona.id === 'superset-agent' ? (
                  <BarChart3 className="w-3.5 h-3.5" />
                ) : (
                  <Code2 className="w-3.5 h-3.5" />
                )}
                {persona.name}
              </button>
            ))}
          </div>

          <button
            onClick={() => setIsCreating(!isCreating)}
            className={`inline-flex items-center gap-1 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              isCreating
                ? 'bg-m3-primary text-m3-on-primary shadow-xs'
                : 'bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            New Agent
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto pr-1">
          {isCreating ? (
            <form onSubmit={handleCreateAgent} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-m3-on-surface mb-1">Agent Name</label>
                <input
                  type="text"
                  required
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  placeholder="e.g. Infrastructure DevOps Agent"
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-m3-on-surface mb-1">Role Description</label>
                <input
                  type="text"
                  value={newAgentRole}
                  onChange={(e) => setNewAgentRole(e.target.value)}
                  placeholder="e.g. Focuses on Kubernetes, Terraform, and cloud deployments"
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-m3-on-surface mb-1">System Instructions (Prompt)</label>
                <textarea
                  rows={6}
                  required
                  value={newAgentPrompt}
                  onChange={(e) => setNewAgentPrompt(e.target.value)}
                  placeholder="Define the agent's behavior, guidelines, and tool priorities..."
                  className="w-full p-3 font-mono text-xs rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-m3-on-surface outline-none focus:border-m3-primary"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-4 py-2 rounded-full text-xs font-semibold hover:bg-m3-surface-container text-m3-on-surface-variant"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-90 shadow-xs"
                >
                  Create Agent
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col h-full">
              {/* Persona Description */}
              {selectedPersona && (
                <div className="p-3.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/20 mb-3 flex items-center justify-between">
                  <p className="text-xs text-m3-on-surface-variant leading-relaxed">
                    <strong>Role Focus:</strong> {selectedPersona.role_description}
                  </p>
                  {!selectedPersona.is_default && (
                    <button
                      onClick={() => handleDeleteAgent(selectedPersona.id)}
                      className="p-1.5 rounded-full text-m3-error hover:bg-m3-error-container/40 transition-colors ml-2"
                      title="Delete custom agent"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}

              {/* Editor Area */}
              <div className="flex-1 flex flex-col min-h-[260px]">
                <label className="text-xs font-semibold text-m3-on-surface mb-1 flex items-center justify-between">
                  <span>System Instruction Set (Prompt)</span>
                  <span className="text-[11px] text-m3-on-surface-variant font-normal">
                    Changes take effect on subsequent messages
                  </span>
                </label>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  className="flex-1 p-4 font-mono text-xs rounded-2xl bg-m3-surface-container-lowest border border-m3-outline-variant/40 text-m3-on-surface outline-none focus:border-m3-primary resize-none leading-relaxed"
                  placeholder="Enter custom instructions..."
                />
              </div>

              {/* Footer actions */}
              <div className="flex items-center justify-between pt-4 mt-3 border-t border-m3-outline-variant/20 shrink-0">
                <div className="flex items-center gap-2">
                  {savedSuccess && (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                      <CheckCircle className="w-4 h-4" /> Instructions saved successfully!
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-full text-xs font-semibold hover:bg-m3-surface-container transition-colors text-m3-on-surface-variant"
                  >
                    Close
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-90 transition-opacity shadow-xs"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saving ? 'Saving...' : 'Save Instructions'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
