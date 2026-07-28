import { Settings } from 'lucide-react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

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
  buttonClassName,
  isAvatarKey,
} from '.';

describe('design system primitives', () => {
  it('builds stable button variants and pending semantics', () => {
    expect(
      buttonClassName({ size: 'compact', variant: 'secondary' }),
    ).toContain('button--secondary');
    render(
      <Button pending pendingLabel="Finding player…">
        Play
      </Button>,
    );
    expect(
      screen.getByRole('button', { name: 'Finding player…' }),
    ).toBeDisabled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });

  it('connects field, select, and switch labels to their controls', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <>
        <Field error="Name is required" label="Guest name" />
        <Select
          error="Choose a mode"
          label="Input mode"
          options={[{ label: 'Tap', value: 'tap' }]}
        />
        <Switch
          checked={false}
          label="Show coordinates"
          onCheckedChange={onCheckedChange}
        />
      </>,
    );

    expect(screen.getByLabelText('Guest name')).toHaveAccessibleErrorMessage(
      'Name is required',
    );
    expect(screen.getByLabelText('Input mode')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await user.click(screen.getByRole('switch', { name: 'Show coordinates' }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('keeps the exact avatar allowlist and provides a safe fallback', () => {
    expect(AVATAR_KEYS).toHaveLength(8);
    expect(new Set(AVATAR_KEYS).size).toBe(8);
    expect(isAvatarKey('knight_amber_01')).toBe(true);
    expect(isAvatarKey('arbitrary-url')).toBe(false);
    const { container } = render(
      <Avatar label="Fallback avatar" value="arbitrary-url" />,
    );
    expect(container.firstChild).toHaveClass('avatar--fallback');
  });

  it('opens a dialog with initial focus on the safe action', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog
        description="Your identity cannot be recovered."
        destructive
        onClose={onClose}
        open={false}
        title="Reset identity?"
      >
        Reset details
      </Dialog>,
    );

    rerender(
      <Dialog
        description="Your identity cannot be recovered."
        destructive
        onClose={onClose}
        open
        title="Reset identity?"
      >
        Reset details
      </Dialog>,
    );

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();
    await user.click(cancel);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('removes a closed drawer and its controls from interaction', async () => {
    const onClose = vi.fn();
    const { container, rerender } = render(
      <Drawer onClose={onClose} open={false} title="Game details">
        Move history
      </Drawer>,
    );

    const drawer = screen.getByLabelText('Game details', { selector: 'aside' });
    expect(drawer).toHaveAttribute('inert');
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
    expect(
      (
        await axe.run(container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);

    rerender(
      <Drawer onClose={onClose} open title="Game details">
        Move history
      </Drawer>,
    );
    expect(drawer).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeVisible();
  });

  it('renders status, navigation, content, and tooltip primitives accessibly', async () => {
    const onRetry = vi.fn();
    const { container } = render(
      <main>
        <Breadcrumbs
          items={[{ href: '/', label: 'Home' }, { label: 'Current' }]}
        />
        <Card as="section" selected>
          Selected content
        </Card>
        <Badge tone="success">Connected</Badge>
        <FeedbackState
          actionLabel="Retry"
          correlationId="demo-a81f"
          kind="error"
          onAction={onRetry}
          title="Could not connect"
        />
        <Skeleton label="Loading board" variant="board" />
        <Toast message="Move confirmed" tone="success" />
        <Tooltip content="Local preferences">
          <IconButton aria-label="Open settings">
            <Settings aria-hidden="true" />
          </IconButton>
        </Tooltip>
      </main>,
    );

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.getByText('Current')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('alert')).toHaveTextContent('demo-a81f');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Local preferences');
    expect(
      (
        await axe.run(container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });
});
