import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { describePiece } from './chess-piece';
import { DemoChessBoard } from './demo-chessboard';

describe('DemoChessBoard', () => {
  it('exposes all 64 squares and chess states without relying on colour', () => {
    render(
      <DemoChessBoard checked="e8" pending={['e2', 'e4']} selected="f3" />,
    );

    expect(screen.getAllByRole('gridcell')).toHaveLength(64);
    expect(
      screen.getByRole('gridcell', { name: /f3, white knight/ }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('gridcell', { name: /e8, black king.*king in check/ }),
    ).toBeVisible();
    expect(
      screen.getByRole('gridcell', { name: /e4, white pawn.*move pending/ }),
    ).toBeVisible();
  });

  it('implements roving focus, row bounds, board bounds, selection, and escape', async () => {
    const user = userEvent.setup();
    render(<DemoChessBoard selected="f3" />);

    const f3 = screen.getByRole('gridcell', { name: /f3,/ });
    f3.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('gridcell', { name: /g3,/ })).toHaveFocus();

    await user.keyboard('{Home}');
    expect(screen.getByRole('gridcell', { name: /a3,/ })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('gridcell', { name: /h3,/ })).toHaveFocus();
    await user.keyboard('{Control>}{Home}{/Control}');
    expect(screen.getByRole('gridcell', { name: /a8,/ })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowLeft}');
    expect(screen.getByRole('gridcell', { name: /a8,/ })).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByText('a8 selected')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByText('Selection cleared')).toBeInTheDocument();
  });

  it('supports reverse orientation and read-only activation', () => {
    render(<DemoChessBoard orientation="black" readOnly selected="a1" />);
    const firstSquare = screen.getAllByRole('gridcell')[0];
    expect(firstSquare).toHaveAccessibleName(/h1,/);

    const e4 = screen.getByRole('gridcell', { name: /e4,/ });
    fireEvent.click(e4);
    expect(screen.getByText('a1 selected')).toBeInTheDocument();
    expect(e4).toHaveAttribute('aria-disabled', 'true');
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<DemoChessBoard />);
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it('maps every typed piece code to a readable name', () => {
    expect(describePiece('wk')).toBe('white king');
    expect(describePiece('bq')).toBe('black queen');
    expect(describePiece('wn')).toBe('white knight');
  });
});
