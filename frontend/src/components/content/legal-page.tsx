import type { ReactNode } from 'react';

import { Breadcrumbs } from '@/components/ui';

export function LegalPage({
  children,
  eyebrow,
  summary,
  title,
}: {
  children: ReactNode;
  eyebrow: string;
  summary: string;
  title: string;
}) {
  return (
    <article className="legal-page public-container">
      <Breadcrumbs items={[{ href: '/', label: 'Home' }, { label: title }]} />
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="display">{title}</h1>
      <p>{summary}</p>
      {children}
    </article>
  );
}
