import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-6 text-center h-full min-h-[160px] bg-red-500/5 dark:bg-red-500/10 rounded-2xl border border-red-500/20">
          <AlertTriangle className="w-8 h-8 text-red-500 mb-2" />
          <h4 className="font-semibold text-sm text-m3-on-surface mb-1">
            {this.props.fallbackTitle || 'Widget Failed to Render'}
          </h4>
          <p className="text-xs text-m3-on-surface-variant max-w-xs mb-3 truncate">
            {this.state.error?.message || 'An unexpected rendering error occurred'}
          </p>
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-m3-surface-container-high hover:bg-m3-surface-container-highest text-m3-on-surface transition-colors border border-m3-outline-variant/30"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
