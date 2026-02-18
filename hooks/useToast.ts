import { useCallback } from 'react';
import { useToast as useToastContext } from '../contexts/ToastContext';
import { ToastType } from '../components/Toast';

export const useToast = () => {
  const { addToast, removeToast } = useToastContext();

  const success = useCallback((message: string) => addToast(message, 'success'), [addToast]);
  const error = useCallback((message: string) => addToast(message, 'error'), [addToast]);
  const warning = useCallback((message: string) => addToast(message, 'warning'), [addToast]);
  const info = useCallback((message: string) => addToast(message, 'info'), [addToast]);

  return {
    addToast,
    removeToast,
    success,
    error,
    warning,
    info
  };
};
