import type { ReactNode } from 'react';

interface AlertBannerProps {
  children: ReactNode;
  title?: string;
  tone?: 'error' | 'information' | 'success';
}

export function AlertBanner({
  children,
  title,
  tone = 'information',
}: AlertBannerProps) {
  const isError = tone === 'error';

  return (
    <div
      className={`alert-banner alert-banner--${tone}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
    >
      {title ? <p className="alert-banner__title">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}
