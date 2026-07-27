import React, { ButtonHTMLAttributes, forwardRef } from 'react';
import { LucideIcon } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'secondary',
      size = 'md',
      icon: Icon,
      iconPosition = 'left',
      fullWidth = false,
      loading = false,
      disabled,
      className = '',
      ...props
    },
    ref
  ) => {
    const baseStyles = 'inline-flex items-center justify-center gap-2 font-term uppercase tracking-widest transition-all duration-300 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] disabled:opacity-50 disabled:cursor-not-allowed';

    const variantStyles = {
      primary: 'bg-[var(--accent-green)] text-black hover:brightness-110 focus-visible:ring-[var(--accent-green)] shadow-[0_0_16px_rgba(0,255,65,0.35)]',
      secondary: 'bg-[rgba(0,255,65,0.05)] text-[var(--text-secondary)] border border-[var(--border-dim)] hover:bg-[rgba(0,255,65,0.1)] hover:text-[var(--accent-green)] hover:border-[var(--border-green)] focus-visible:ring-[var(--accent-green)]/50',
      danger: 'bg-[rgba(255,59,92,0.1)] text-[var(--accent-red)] border border-[var(--accent-red)]/30 hover:bg-[rgba(255,59,92,0.2)] hover:border-[var(--accent-red)]/50 focus-visible:ring-[var(--accent-red)]/50',
      ghost: 'bg-transparent text-[var(--text-secondary)] hover:bg-[rgba(0,255,65,0.1)] hover:text-[var(--accent-green)] focus-visible:ring-[var(--accent-green)]/30',
      success: 'bg-[rgba(0,255,65,0.1)] text-[var(--accent-green)] border border-[var(--border-green)] hover:bg-[rgba(0,255,65,0.2)] hover:border-[var(--accent-green)]/50 focus-visible:ring-[var(--accent-green)]/50',
    };

    const sizeStyles = {
      sm: 'px-3 py-1.5 text-xs',
      md: 'px-4 py-2.5 text-sm',
      lg: 'px-6 py-3 text-base',
      xl: 'px-8 py-4 text-lg',
    };

    const iconSizeMap = {
      sm: 14,
      md: 16,
      lg: 20,
      xl: 24,
    };

    const combinedClassName = `
      ${baseStyles}
      ${variantStyles[variant]}
      ${sizeStyles[size]}
      ${fullWidth ? 'w-full' : ''}
      ${className}
    `.trim();

    return (
      <button
        ref={ref}
        className={combinedClassName}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <svg
              className="animate-spin"
              width={iconSizeMap[size]}
              height={iconSizeMap[size]}
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            {children && <span>Loading...</span>}
          </>
        ) : (
          <>
            {Icon && iconPosition === 'left' && <Icon size={iconSizeMap[size]} aria-hidden="true" />}
            {children}
            {Icon && iconPosition === 'right' && <Icon size={iconSizeMap[size]} aria-hidden="true" />}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
