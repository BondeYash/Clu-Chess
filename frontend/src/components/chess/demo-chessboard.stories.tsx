import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { DemoChessBoard } from './demo-chessboard';

const meta = {
  component: DemoChessBoard,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '42rem' }}>
        <Story />
      </div>
    ),
  ],
  title: 'Chess/Board',
} satisfies Meta<typeof DemoChessBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SelectedAndLegal: Story = {};

export const PendingMove: Story = {
  args: {
    pending: ['f3', 'e5'],
    readOnly: true,
  },
};

export const InCheck: Story = {
  args: {
    checked: 'e1',
    legalCaptures: [],
    legalTargets: [],
    selected: 'e1',
  },
};

export const BlackOrientation: Story = {
  args: {
    orientation: 'black',
  },
};

export const ReadOnlyWithoutCoordinates: Story = {
  args: {
    coordinates: false,
    readOnly: true,
  },
};
