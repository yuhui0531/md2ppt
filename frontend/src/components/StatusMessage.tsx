import type { ReactNode } from 'react';

interface StatusMessageProps {
  kind?: 'info' | 'success' | 'error';
  children: ReactNode;
}

export function StatusMessage({ kind = 'info', children }: StatusMessageProps) {
  return <div className={`status ${kind}`}>{children}</div>;
}
