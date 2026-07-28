'use client';

import { X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';

import { Button } from './button';
import { IconButton } from './icon-button';

export interface DialogProps {
  children: ReactNode;
  confirmLabel?: string;
  confirmPending?: boolean;
  description: string;
  destructive?: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  open: boolean;
  title: string;
}

export function Dialog({
  children,
  confirmLabel = 'Confirm reset',
  confirmPending = false,
  description,
  destructive = false,
  onClose,
  onConfirm,
  open,
  title,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>('[data-safe-action]')?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="dialog__header">
        <div>
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{description}</p>
        </div>
        <IconButton
          aria-label="Close dialog"
          disabled={confirmPending}
          onClick={onClose}
        >
          <X aria-hidden="true" size={20} />
        </IconButton>
      </div>
      <div className="dialog__body">{children}</div>
      <div className="dialog__actions">
        <Button
          data-safe-action
          disabled={confirmPending}
          onClick={onClose}
          variant="secondary"
        >
          Cancel
        </Button>
        {destructive ? (
          <Button
            onClick={onConfirm}
            pending={confirmPending}
            pendingLabel="Resetting identity…"
            variant="destructive"
          >
            {confirmLabel}
          </Button>
        ) : null}
      </div>
    </dialog>
  );
}
