(() => {
  'use strict';

  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
  const pieces = new Map([
    ['e8', { color: 'black', glyph: '♚', name: 'king' }],
    ['f5', { color: 'black', glyph: '♟', name: 'pawn' }],
    ['d4', { color: 'white', glyph: '♘', name: 'knight' }],
    ['e1', { color: 'white', glyph: '♔', name: 'king' }],
  ]);
  const knightTargets = new Set([
    'b3',
    'b5',
    'c2',
    'c6',
    'e2',
    'e6',
    'f3',
    'f5',
  ]);

  const board = document.querySelector('#board');
  const status = document.querySelector('#status');
  if (!(board instanceof HTMLElement) || !(status instanceof HTMLElement)) {
    return;
  }

  let focusIndex = ranks.indexOf('4') * 8 + files.indexOf('d');
  let selectedSquare = null;
  const buttons = [];

  for (const [rankIndex, rank] of ranks.entries()) {
    for (const [fileIndex, file] of files.entries()) {
      const square = `${file}${rank}`;
      const piece = pieces.get(square);
      const button = document.createElement('button');
      const isLight = (rankIndex + fileIndex) % 2 === 0;
      button.type = 'button';
      button.className = `square ${isLight ? 'light' : 'dark'}`;
      button.dataset.square = square;
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-label', squareLabel(square));
      button.tabIndex = buttons.length === focusIndex ? 0 : -1;
      button.innerHTML = `${
        piece === undefined
          ? ''
          : `<span aria-hidden="true">${piece.glyph}</span>`
      }<span class="coordinate" aria-hidden="true">${square}</span>`;
      button.addEventListener('focus', () => {
        focusIndex = buttons.indexOf(button);
      });
      button.addEventListener('click', () => activate(square));
      button.addEventListener('keydown', onKeyDown);
      buttons.push(button);
      board.append(button);
    }
  }

  function onKeyDown(event) {
    const current = event.currentTarget;
    if (!(current instanceof HTMLButtonElement)) {
      return;
    }

    const currentIndex = buttons.indexOf(current);
    const row = Math.floor(currentIndex / 8);
    const column = currentIndex % 8;
    let nextIndex = currentIndex;

    switch (event.key) {
      case 'ArrowLeft':
        nextIndex = row * 8 + Math.max(0, column - 1);
        break;
      case 'ArrowRight':
        nextIndex = row * 8 + Math.min(7, column + 1);
        break;
      case 'ArrowUp':
        nextIndex = Math.max(0, row - 1) * 8 + column;
        break;
      case 'ArrowDown':
        nextIndex = Math.min(7, row + 1) * 8 + column;
        break;
      case 'Home':
        nextIndex = event.ctrlKey ? 0 : row * 8;
        break;
      case 'End':
        nextIndex = event.ctrlKey ? 63 : row * 8 + 7;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        activate(current.dataset.square);
        return;
      case 'Escape':
        event.preventDefault();
        clearSelection('Selection canceled.');
        return;
      default:
        return;
    }

    event.preventDefault();
    moveFocus(nextIndex);
  }

  function moveFocus(nextIndex) {
    buttons[focusIndex].tabIndex = -1;
    focusIndex = nextIndex;
    buttons[focusIndex].tabIndex = 0;
    buttons[focusIndex].focus();
  }

  function activate(square) {
    if (typeof square !== 'string') {
      return;
    }

    if (selectedSquare === null) {
      if (square !== 'd4') {
        status.textContent = `${squareLabel(square)}. Select the white knight on d4 for this prototype.`;
        return;
      }
      selectedSquare = square;
      renderSelection();
      status.textContent =
        'White knight selected on d4. Eight legal targets are marked.';
      return;
    }

    if (square === selectedSquare) {
      clearSelection('Selection canceled.');
      return;
    }

    if (knightTargets.has(square)) {
      const capture = pieces.get(square)?.color === 'black';
      status.textContent = `Prototype move: knight d4 to ${square}${
        capture ? ', capturing black pawn' : ''
      }. No command was submitted.`;
      clearSelection(status.textContent);
      return;
    }

    status.textContent = `${square} is not a marked target.`;
  }

  function renderSelection() {
    for (const button of buttons) {
      const square = button.dataset.square;
      button.classList.toggle('selected', square === selectedSquare);
      button.classList.toggle(
        'legal',
        square !== undefined &&
          knightTargets.has(square) &&
          !pieces.has(square),
      );
      button.classList.toggle(
        'capture',
        square !== undefined &&
          knightTargets.has(square) &&
          pieces.get(square)?.color === 'black',
      );
      button.setAttribute('aria-label', squareLabel(square));
    }
  }

  function clearSelection(message) {
    selectedSquare = null;
    renderSelection();
    status.textContent = message;
  }

  function squareLabel(square) {
    if (typeof square !== 'string') {
      return 'Unknown square';
    }
    const piece = pieces.get(square);
    const state = [];
    if (square === selectedSquare) {
      state.push('selected');
    }
    if (selectedSquare !== null && knightTargets.has(square)) {
      state.push(piece === undefined ? 'legal target' : 'legal capture');
    }
    return `${square}, ${
      piece === undefined ? 'empty' : `${piece.color} ${piece.name}`
    }${state.length === 0 ? '' : `, ${state.join(', ')}`}`;
  }
})();
