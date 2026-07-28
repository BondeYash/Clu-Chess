'use client';

import { type KeyboardEvent, useMemo, useRef, useState } from 'react';

import { classNames } from '@/lib/class-names';

import { ChessPiece, describePiece, type PieceCode } from './chess-piece';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const;

export type Square = `${(typeof FILES)[number]}${(typeof RANKS)[number]}`;

export const DEMO_POSITION: Partial<Record<Square, PieceCode>> = {
  a1: 'wr',
  a2: 'wp',
  a7: 'bp',
  a8: 'br',
  b1: 'wn',
  b2: 'wp',
  b7: 'bp',
  c1: 'wb',
  c2: 'wp',
  c6: 'bn',
  c7: 'bp',
  c8: 'bb',
  d1: 'wq',
  d2: 'wp',
  d7: 'bp',
  d8: 'bq',
  e1: 'wk',
  e4: 'wp',
  e5: 'bp',
  e8: 'bk',
  f1: 'wb',
  f2: 'wp',
  f3: 'wn',
  f7: 'bp',
  f8: 'bb',
  g2: 'wp',
  g7: 'bp',
  g8: 'bn',
  h1: 'wr',
  h2: 'wp',
  h7: 'bp',
  h8: 'br',
};

export interface DemoChessBoardProps {
  checked?: Square;
  coordinates?: boolean;
  label?: string;
  lastMove?: readonly Square[];
  legalCaptures?: readonly Square[];
  legalTargets?: readonly Square[];
  orientation?: 'black' | 'white';
  pending?: readonly Square[];
  position?: Partial<Record<Square, PieceCode>>;
  readOnly?: boolean;
  selected?: Square;
}

export function DemoChessBoard({
  checked,
  coordinates = true,
  label = 'Demonstration chessboard',
  lastMove = ['b8', 'c6'],
  legalCaptures = ['e5'],
  legalTargets = ['d4', 'g5', 'h4'],
  orientation = 'white',
  pending,
  position = DEMO_POSITION,
  readOnly = false,
  selected: initialSelected = 'f3',
}: DemoChessBoardProps) {
  const squares = useMemo(
    () => createVisualSquares(orientation),
    [orientation],
  );
  const [focusedIndex, setFocusedIndex] = useState(() =>
    Math.max(squares.indexOf(initialSelected), 0),
  );
  const [selected, setSelected] = useState<Square | undefined>(initialSelected);
  const squareRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function focusIndex(nextIndex: number) {
    const bounded = Math.max(0, Math.min(63, nextIndex));
    setFocusedIndex(bounded);
    squareRefs.current[bounded]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const rowStart = Math.floor(focusedIndex / 8) * 8;
    let nextIndex = focusedIndex;

    if (event.key === 'ArrowLeft' && focusedIndex % 8 > 0) nextIndex -= 1;
    if (event.key === 'ArrowRight' && focusedIndex % 8 < 7) nextIndex += 1;
    if (event.key === 'ArrowUp' && focusedIndex >= 8) nextIndex -= 8;
    if (event.key === 'ArrowDown' && focusedIndex < 56) nextIndex += 8;
    if (event.key === 'Home') {
      nextIndex = event.ctrlKey ? 0 : rowStart;
    }
    if (event.key === 'End') {
      nextIndex = event.ctrlKey ? 63 : rowStart + 7;
    }
    if (event.key === 'Escape') {
      setSelected(undefined);
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      setSelected(squares[focusedIndex]);
      event.preventDefault();
      return;
    }

    if (nextIndex !== focusedIndex) {
      event.preventDefault();
      focusIndex(nextIndex);
    }
  }

  return (
    <div className="board-frame">
      <div
        aria-label={label}
        className={classNames('chessboard', readOnly && 'chessboard--readonly')}
        role="grid"
      >
        {Array.from({ length: 8 }, (_, visualRow) => (
          <div className="chess-row" key={visualRow} role="row">
            {squares
              .slice(visualRow * 8, visualRow * 8 + 8)
              .map((square, visualColumn) => {
                const index = visualRow * 8 + visualColumn;
                const piece = position[square];
                const file = square[0];
                const rank = Number(square[1]);
                const fileIndex = FILES.indexOf(file as (typeof FILES)[number]);
                const dark = (fileIndex + rank) % 2 === 1;
                const selectedSquare = selected === square;
                const legalTarget = legalTargets.includes(square);
                const legalCapture = legalCaptures.includes(square);
                const last = lastMove.includes(square);
                const pendingSquare = pending?.includes(square) ?? false;
                const states = [
                  piece ? describePiece(piece) : 'empty',
                  selectedSquare ? 'selected' : '',
                  legalTarget ? 'legal target' : '',
                  legalCapture ? 'legal capture' : '',
                  last ? 'last move' : '',
                  checked === square ? 'king in check' : '',
                  pendingSquare ? 'move pending' : '',
                ].filter(Boolean);

                return (
                  <button
                    aria-disabled={readOnly || undefined}
                    aria-label={`${square}, ${states.join(', ')}`}
                    aria-selected={selectedSquare || undefined}
                    className={classNames(
                      'chess-square',
                      dark ? 'chess-square--dark' : 'chess-square--light',
                      selectedSquare && 'chess-square--selected',
                      legalTarget && 'chess-square--legal',
                      legalCapture && 'chess-square--capture',
                      last && 'chess-square--last',
                      checked === square && 'chess-square--check',
                      pendingSquare && 'chess-square--pending',
                    )}
                    key={square}
                    onClick={() => {
                      if (!readOnly) setSelected(square);
                    }}
                    onFocus={() => setFocusedIndex(index)}
                    onKeyDown={handleKeyDown}
                    ref={(node) => {
                      squareRefs.current[index] = node;
                    }}
                    role="gridcell"
                    tabIndex={index === focusedIndex ? 0 : -1}
                    type="button"
                  >
                    {piece ? <ChessPiece piece={piece} /> : null}
                    {coordinates && visualRow === 7 ? (
                      <span
                        aria-hidden="true"
                        className="chess-coordinate chess-coordinate--file"
                      >
                        {file}
                      </span>
                    ) : null}
                    {coordinates && visualColumn === 0 ? (
                      <span
                        aria-hidden="true"
                        className="chess-coordinate chess-coordinate--rank"
                      >
                        {rank}
                      </span>
                    ) : null}
                  </button>
                );
              })}
          </div>
        ))}
      </div>
      <p aria-live="polite" className="sr-only">
        {selected ? `${selected} selected` : 'Selection cleared'}
      </p>
    </div>
  );
}

function createVisualSquares(orientation: 'black' | 'white'): Square[] {
  const files = orientation === 'white' ? FILES : [...FILES].reverse();
  const ranks = orientation === 'white' ? RANKS : [...RANKS].reverse();

  return ranks.flatMap((rank) =>
    files.map((file) => `${file}${rank}` as Square),
  );
}
