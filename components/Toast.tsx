import React, { useEffect } from 'react';
import { CheckCircle, AlertCircle, Info, X, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
  duration?: number;
}

const Toast: React.FC<ToastProps> = ({ message, type, onClose, duration = 5000 }) => {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const config = {
    success: {
      icon: CheckCircle,
      borderColor: 'var(--accent-green)',
      textColor: 'text-[var(--text-primary)]',
      iconColor: 'text-[var(--accent-green)]',
    },
    error: {
      icon: AlertCircle,
      borderColor: 'var(--accent-red)',
      textColor: 'text-[var(--text-primary)]',
      iconColor: 'text-[var(--accent-red)]',
    },
    warning: {
      icon: AlertTriangle,
      borderColor: 'var(--accent-amber)',
      textColor: 'text-[var(--text-primary)]',
      iconColor: 'text-[var(--accent-amber)]',
    },
    info: {
      icon: Info,
      borderColor: 'var(--accent-green)',
      textColor: 'text-[var(--text-primary)]',
      iconColor: 'text-[var(--accent-green)]',
    },
  };

  const { icon: Icon, borderColor, textColor, iconColor } = config[type];

  return (
    <div
      className={`flex items-center gap-3 ${textColor} px-4 py-3 shadow-2xl backdrop-blur-md animate-slide-in-down font-[var(--font-term)]`}
      style={{
        background: 'rgba(1,7,3,0.92)',
        borderLeft: `2px solid ${borderColor}`,
        border: `1px solid var(--border-dim)`,
        borderLeftWidth: '2px',
        borderLeftColor: borderColor,
        borderRadius: 'var(--radius-sm, 4px)',
      }}
      role="alert"
      aria-live="polite"
      aria-atomic="true"
    >
      <Icon size={20} className={iconColor} aria-hidden="true" />
      <span className="text-sm flex-1 tracking-wide">{message}</span>
      <button
        onClick={onClose}
        className="ml-2 hover:bg-[rgba(0,255,65,0.1)] p-1 rounded transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        aria-label="Close notification"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default Toast;
