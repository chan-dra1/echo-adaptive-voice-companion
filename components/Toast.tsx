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
      bgColor: 'bg-green-950/90',
      borderColor: 'border-green-500/30',
      textColor: 'text-green-200',
      iconColor: 'text-green-400',
    },
    error: {
      icon: AlertCircle,
      bgColor: 'bg-red-950/90',
      borderColor: 'border-red-500/30',
      textColor: 'text-red-200',
      iconColor: 'text-red-400',
    },
    warning: {
      icon: AlertTriangle,
      bgColor: 'bg-amber-950/90',
      borderColor: 'border-amber-500/30',
      textColor: 'text-amber-200',
      iconColor: 'text-amber-400',
    },
    info: {
      icon: Info,
      bgColor: 'bg-blue-950/90',
      borderColor: 'border-blue-500/30',
      textColor: 'text-blue-200',
      iconColor: 'text-blue-400',
    },
  };

  const { icon: Icon, bgColor, borderColor, textColor, iconColor } = config[type];

  return (
    <div
      className={`flex items-center gap-3 ${bgColor} border ${borderColor} ${textColor} px-4 py-3 rounded-xl shadow-2xl backdrop-blur-md animate-slide-in-down`}
      role="alert"
      aria-live="polite"
      aria-atomic="true"
    >
      <Icon size={20} className={iconColor} aria-hidden="true" />
      <span className="text-sm font-medium flex-1">{message}</span>
      <button
        onClick={onClose}
        className="ml-2 hover:bg-white/10 p-1 rounded-full transition-colors"
        aria-label="Close notification"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default Toast;
