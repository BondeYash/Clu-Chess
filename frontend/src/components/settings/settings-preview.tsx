'use client';

import { RotateCcw, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  Avatar,
  Button,
  Card,
  Dialog,
  Select,
  Switch,
  Toast,
} from '@/components/ui';
import { useGuestSession } from '@/features/session/session-provider';
import { presentApiError } from '@/lib/api/error-copy';

export function SettingsPreview() {
  const { isResetting, resetError, resetGuest, view } = useGuestSession();
  const [coordinates, setCoordinates] = useState(true);
  const [sound, setSound] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetSucceeded, setResetSucceeded] = useState(false);
  const resetCopy = resetError ? presentApiError(resetError) : undefined;
  const ready = view.status === 'ready' ? view : undefined;

  useEffect(() => {
    if (!resetSucceeded) return;
    const timer = window.setTimeout(() => setResetSucceeded(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [resetSucceeded]);

  if (!ready) return null;
  const { guest } = ready;

  async function confirmReset() {
    try {
      await resetGuest();
      setResetOpen(false);
      setResetSucceeded(true);
    } catch {
      // The mutation error remains in the dialog with a safe retry path.
    }
  }

  return (
    <>
      {resetSucceeded ? (
        <div className="settings-toast">
          <Toast message="A new guest identity is ready" tone="success" />
        </div>
      ) : null}
      <div className="settings-layout">
        <Card as="section" className="settings-section">
          <h2 className="settings-section__heading">Your guest</h2>
          <div className="identity-card">
            <Avatar
              label={`${guest.name} avatar`}
              size="lg"
              value={guest.avatar}
            />
            <div>
              <strong>{guest.name}</strong>
              <p>
                Temporary guest · expires{' '}
                <time dateTime={guest.expiresAt}>
                  {formatExpiry(guest.expiresAt)}
                </time>
              </p>
            </div>
          </div>
        </Card>
        <Card as="section" className="settings-section">
          <h2 className="settings-section__heading">Board</h2>
          <div className="setting-row">
            <div className="setting-row__copy">
              <strong>Show coordinates</strong>
              <span>Display files and ranks around the board.</span>
            </div>
            <Switch
              checked={coordinates}
              label="Show board coordinates"
              onCheckedChange={setCoordinates}
            />
          </div>
          <Select
            defaultValue="both"
            label="Input mode"
            options={[
              { label: 'Tap and drag', value: 'both' },
              { label: 'Tap only', value: 'tap' },
              { label: 'Drag only', value: 'drag' },
            ]}
          />
        </Card>
        <Card as="section" className="settings-section">
          <h2 className="settings-section__heading">Accessibility</h2>
          <Select
            defaultValue="system"
            label="Motion"
            options={[
              { label: 'Follow system', value: 'system' },
              { label: 'Reduce motion', value: 'reduced' },
              { label: 'Full motion', value: 'full' },
            ]}
          />
          <div className="setting-row">
            <div className="setting-row__copy">
              <strong>Sound cues</strong>
              <span>Optional. Every cue also has a visible equivalent.</span>
            </div>
            <Switch
              checked={sound}
              label="Sound cues"
              onCheckedChange={setSound}
            />
          </div>
        </Card>
        <Card
          as="section"
          className="settings-section settings-section--danger"
        >
          <h2 className="settings-section__heading">Identity</h2>
          <p className="muted">
            Guest identities cannot be recovered across devices or after expiry.
          </p>
          {ready.activeGameId ? (
            <p className="setting-warning">
              <ShieldAlert aria-hidden="true" size={18} />
              Resetting now abandons the active game immediately.
            </p>
          ) : null}
          <div>
            <Button onClick={() => setResetOpen(true)} variant="destructive">
              <RotateCcw aria-hidden="true" size={17} />
              Start with a new identity
            </Button>
          </div>
        </Card>
      </div>
      <Dialog
        confirmLabel="Reset and create new guest"
        confirmPending={isResetting}
        description={
          ready.activeGameId
            ? 'Your generated name and knight cannot be recovered, and your active game will be abandoned immediately.'
            : 'Your generated name and knight cannot be recovered after reset.'
        }
        destructive
        onClose={() => {
          if (!isResetting) setResetOpen(false);
        }}
        onConfirm={() => void confirmReset()}
        open={resetOpen}
        title="Start with a new identity?"
      >
        <p>
          The old bearer token, pending request keys, active-game hint, and
          guest-owned query data are cleared only after the server confirms the
          reset.
        </p>
        {resetCopy ? (
          <div className="dialog-error" role="alert">
            <strong>{resetCopy.title}</strong>
            <p>{resetCopy.message}</p>
            {resetCopy.correlationId ? (
              <p>
                Reference: <code>{resetCopy.correlationId}</code>
              </p>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

function formatExpiry(expiresAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(expiresAt));
}
