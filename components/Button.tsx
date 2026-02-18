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
    const baseStyles = 'inline-flex items-center justify-center gap-2 font-medium transition-all duration-300 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-echo-dark disabled:opacity-50 disabled:cursor-not-allowed';

    const variantStyles = {
      primary: 'bg-echo-primary text-white hover:bg-blue-600 focus-visible:ring-echo-primary shadow-lg shadow-echo-primary/20',
      secondary: 'bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10 hover:text-white hover:border-white/20 focus-visible:ring-white/50',
      danger: 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50 focus-visible:ring-red-500/50',
      ghost: 'bg-transparent text-gray-400 hover:bg-white/5 hover:text-white focus-visible:ring-white/30',
      success: 'bg-green-500/10 text-green-400 border border-green-500/30 hover:bg-green-500/20 hover:border-green-500/50 focus-visible:ring-green-500/50',
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
