'use client';

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Settings } from 'lucide-react';
import { useState } from 'react';

import {
  AVATAR_KEYS,
  Avatar,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Dialog,
  Drawer,
  FeedbackState,
  Field,
  IconButton,
  Select,
  Skeleton,
  Switch,
  Toast,
  Tooltip,
} from '.';

const meta = {
  component: Button,
  parameters: { layout: 'padded' },
  title: 'Design System/Primitives',
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllStates: Story = {
  render: () => <PrimitiveCatalog />,
};

function PrimitiveCatalog() {
  const [checked, setChecked] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="story-catalog">
      <section>
        <h2>Buttons</h2>
        <div className="story-row">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
          <Button pending pendingLabel="Finding player…">
            Find match
          </Button>
          <Tooltip content="Local preferences">
            <IconButton aria-label="Open settings">
              <Settings aria-hidden="true" size={20} />
            </IconButton>
          </Tooltip>
        </div>
      </section>
      <section>
        <h2>Badges and avatars</h2>
        <div className="story-row">
          <Badge>Connecting</Badge>
          <Badge tone="success">Connected</Badge>
          <Badge tone="warning">Reconnecting</Badge>
          <Badge tone="danger">Offline</Badge>
        </div>
        <div className="story-row">
          {AVATAR_KEYS.map((key) => (
            <Avatar key={key} label={key} value={key} />
          ))}
          <Avatar label="Unknown avatar fallback" value="unknown" />
          <Avatar label="Avatar loading" loading />
        </div>
      </section>
      <section>
        <h2>Cards</h2>
        <div className="story-grid">
          <Card>Default card</Card>
          <Card variant="interactive">Interactive card</Card>
          <Card selected>Selected card</Card>
          <Card variant="inverse">Inverse card</Card>
        </div>
      </section>
      <section>
        <h2>Fields</h2>
        <div className="story-grid">
          <Field helper="Visible helper text" label="Generated name" />
          <Field error="Choose a value" label="Invalid field" />
          <Field label="Valid field" valid value="Saved locally" readOnly />
          <Select
            label="Input mode"
            options={[
              { label: 'Tap and drag', value: 'both' },
              { label: 'Tap only', value: 'tap' },
            ]}
          />
          <Switch
            checked={checked}
            label="Show coordinates"
            onCheckedChange={setChecked}
          />
          <Switch checked={false} disabled label="Sound unavailable" />
        </div>
      </section>
      <section>
        <h2>Loading and feedback</h2>
        <div className="story-grid">
          <Skeleton />
          <Skeleton variant="avatar" />
          <Skeleton variant="card" />
          <FeedbackState kind="empty" title="No recent games">
            Start a match when you are ready.
          </FeedbackState>
          <FeedbackState kind="success" title="Preference saved">
            Coordinates are now visible.
          </FeedbackState>
          <FeedbackState kind="offline" title="You are offline">
            Your last confirmed position remains safe.
          </FeedbackState>
          <FeedbackState
            correlationId="demo-a81f"
            kind="error"
            title="CluChess is temporarily unavailable"
          >
            Try again without losing confirmed game state.
          </FeedbackState>
        </div>
        <div className="story-row">
          <Toast message="PGN copied" tone="success" />
          <Toast message="Connection restored" />
          <Toast message="Could not save locally" tone="failure" />
        </div>
      </section>
      <section>
        <h2>Navigation and overlays</h2>
        <Breadcrumbs
          items={[
            { href: '/', label: 'Home' },
            { href: '/learn', label: 'Learn' },
            { label: 'King' },
          ]}
        />
        <div className="story-row">
          <Button onClick={() => setDialogOpen(true)} variant="secondary">
            Open dialog
          </Button>
          <Button onClick={() => setDrawerOpen(true)} variant="secondary">
            Open drawer
          </Button>
        </div>
        <Dialog
          description="The safest action receives initial focus."
          destructive
          onClose={() => setDialogOpen(false)}
          open={dialogOpen}
          title="Start with a new identity?"
        >
          This action cannot be undone.
        </Dialog>
        <Drawer
          onClose={() => setDrawerOpen(false)}
          open={drawerOpen}
          title="Game details"
        >
          Drawer content stays distinct from critical clocks.
        </Drawer>
      </section>
    </div>
  );
}
