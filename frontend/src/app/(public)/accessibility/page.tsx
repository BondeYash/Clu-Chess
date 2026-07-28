import type { Metadata } from 'next';

import { LegalPage } from '@/components/content/legal-page';

export const metadata: Metadata = { title: 'Accessibility' };

export default function AccessibilityPage() {
  return (
    <LegalPage
      eyebrow="WCAG 2.2 AA target"
      summary="The complete chess flow is designed for keyboard, touch, screen-reader, reduced-motion, high-contrast, and high-zoom use."
      title="Accessibility"
    >
      <h2>Keyboard board</h2>
      <p>
        Tab enters the board once. Arrow keys move between squares, Enter or
        Space selects, and Escape cancels the current selection.
      </p>
      <h2>More than colour</h2>
      <p>
        Selection, legal targets, check, connection, and results use shape,
        text, and announcements alongside colour.
      </p>
      <h2>Contact and qualification</h2>
      <p>
        Accessibility findings are release blockers when they prevent a core
        journey. Automated checks supplement keyboard and assistive-technology
        review.
      </p>
    </LegalPage>
  );
}
