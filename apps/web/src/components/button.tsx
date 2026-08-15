import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'quiet';
}

export function Button({
  children,
  className = '',
  disabled,
  loading = false,
  variant = 'primary',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`button button--${variant} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading ? <span className="button__spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}
