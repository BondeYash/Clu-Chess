import type { Metadata } from 'next';

import { SettingsPreview } from '@/components/settings/settings-preview';
import { Breadcrumbs } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Settings',
};

export default function SettingsPage() {
  return (
    <>
      <Breadcrumbs
        items={[{ href: '/play', label: 'Play' }, { label: 'Settings' }]}
      />
      <header className="page-heading">
        <p className="eyebrow">Local preferences</p>
        <h1 className="display">Settings</h1>
        <p>
          Board preferences remain local to this browser. Identity reset is
          confirmed by the server and clears guest-owned state safely.
        </p>
      </header>
      <SettingsPreview />
    </>
  );
}
