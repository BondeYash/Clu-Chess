import type { ReactNode } from 'react';

export function Tooltip({
  children,
  content,
}: {
  children: ReactNode;
  content: string;
}) {
  return (
    <span className="tooltip">
      {children}
      <span className="tooltip__content" role="tooltip">
        {content}
      </span>
    </span>
  );
}
