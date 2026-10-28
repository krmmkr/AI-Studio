import React, { useState, useEffect } from 'react';
import { SystemBranding } from '../../types';
import { systemApi } from '../../api/client';
import { X, Shield, Palette, Image as ImageIcon, RotateCcw, Check, Loader2, AlertCircle } from 'lucide-react';

interface AdminBrandingModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBranding: SystemBranding;
  onBrandingUpdated: (newBranding: SystemBranding) => void;
}

export const AdminBrandingModal: React.FC<AdminBrandingModalProps> = ({
  isOpen,
  onClose,
  currentBranding,
  onBrandingUpdated,
}) => {
  const [appName, setAppName] = useState(currentBranding.app_name || 'AI Studio');
  const [logoUrl, setLogoUrl] = useState(currentBranding.logo_url || '');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setAppName(currentBranding.app_name || 'AI Studio');
      setLogoUrl(currentBranding.logo_url || '');
      setErrorMsg(null);
      setSuccessMsg(null);
    }
  }, [isOpen, currentBranding]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      setLoading(true);
      const updated = await systemApi.updateBranding({
        app_name: appName,
        logo_url: logoUrl,
      });
      onBrandingUpdated(updated);
      setSuccessMsg('Branding settings saved successfully!');
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save branding');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      setLoading(true);
      const updated = await systemApi.updateBranding({
        app_name: 'AI Studio',
        logo_url: '',
      });
      setAppName('AI Studio');
      setLogoUrl('');
      onBrandingUpdated(updated);
      setSuccessMsg('Branding reset to default.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to reset branding');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-m3-surface rounded-4xl max-w-md w-full shadow-2xl border border-m3-outline-variant/30 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-m3-outline-variant/20 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-m3-on-surface">Admin & Brand Settings</h2>
              <p className="text-[11px] text-m3-on-surface-variant">Customize platform name and top-left logo</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-m3-surface-container-high flex items-center justify-center text-m3-on-surface-variant hover:text-m3-on-surface transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 flex flex-col gap-4">
          {errorMsg && (
            <div className="p-3 rounded-2xl bg-m3-error-container text-xs text-m3-error font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-medium flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* App Name Input */}
          <div>
            <label className="block text-xs font-semibold text-m3-on-surface mb-1.5 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-m3-primary" />
              Brand / Application Name
            </label>
            <div className="px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 focus-within:border-m3-primary transition-colors">
              <input
                type="text"
                required
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="e.g. Acme Studio"
                className="w-full bg-transparent border-none outline-none text-xs text-m3-on-surface"
              />
            </div>
            <p className="text-[11px] text-m3-on-surface-variant mt-1">
              Replaces the default "AI Studio" brand text in the top-left navigation bar.
            </p>
          </div>

          {/* Logo URL Input */}
          <div>
            <label className="block text-xs font-semibold text-m3-on-surface mb-1.5 flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-m3-primary" />
              Brand Logo URL
            </label>
            <div className="px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 focus-within:border-m3-primary transition-colors">
              <input
                type="text"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="e.g. https://example.com/logo.png or /logo.svg"
                className="w-full bg-transparent border-none outline-none text-xs text-m3-on-surface"
              />
            </div>
            <p className="text-[11px] text-m3-on-surface-variant mt-1">
              Provide an image URL (PNG, SVG, JPG, or data URI). Leave empty to use the default animated icon.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between gap-3 pt-4 border-t border-m3-outline-variant/20 mt-2">
            <button
              type="button"
              onClick={handleReset}
              disabled={loading}
              className="px-3 py-2 rounded-xl text-xs font-medium text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container-high transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Reset to default AI Studio logo and name"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Default</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 rounded-full text-xs font-medium text-m3-on-surface-variant hover:bg-m3-surface-container-high transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-95 transition-opacity shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
