'use client';

import { RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { Avatar, Button, Card, Dialog, Select, Switch } from '@/components/ui';

export function SettingsPreview() {
  const [coordinates, setCoordinates] = useState(true);
  const [sound, setSound] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  return (
    <>
      <div className="settings-layout">
        <Card as="section" className="settings-section">
          <h2 className="settings-section__heading">Your guest</h2>
          <div className="identity-card">
            <Avatar
              label="SilentKnight482 avatar"
              size="lg"
              value="knight_amber_01"
            />
            <div>
              <strong>SilentKnight482</strong>
              <p>Fixture identity · expires in 11 hours</p>
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
          <div>
            <Button onClick={() => setResetOpen(true)} variant="destructive">
              <RotateCcw aria-hidden="true" size={17} />
              Start with a new identity
            </Button>
          </div>
        </Card>
      </div>
      <Dialog
        description="Your generated name and knight cannot be recovered. This fixture does not perform a backend mutation."
        destructive
        onClose={() => setResetOpen(false)}
        open={resetOpen}
        title="Start with a new identity?"
      >
        <p>
          During a live game this action will also warn that the game is
          abandoned immediately.
        </p>
      </Dialog>
    </>
  );
}
