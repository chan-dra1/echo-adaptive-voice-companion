import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] render crash:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="w-screen h-screen bg-black text-[#00ff41] font-mono flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="text-xl tracking-widest uppercase">Echo hit a snag</div>
          <div className="text-xs text-[#00ff41]/60 max-w-md break-words">
            {this.state.error.message || 'Unknown error'}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-md border border-[#00ff41]/40 hover:bg-[#00ff41]/10 text-xs uppercase tracking-widest transition-colors"
          >
            Reload
          </button>
        </div>
      );
    }
    return (this as any).props.children;
  }
}
