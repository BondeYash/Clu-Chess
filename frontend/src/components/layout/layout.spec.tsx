import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApplicationFrame } from './application-frame';
import { PublicHeader } from './public-header';

describe('layout foundations', () => {
  it('exposes a labelled primary navigation', () => {
    render(<PublicHeader />);

    expect(screen.getByRole('link', { name: 'CluChess home' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  });

  it('places feature content inside the application main landmark', () => {
    render(
      <ApplicationFrame>
        <h1>Board</h1>
      </ApplicationFrame>,
    );

    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('heading', { name: 'Board' }),
    );
  });
});
