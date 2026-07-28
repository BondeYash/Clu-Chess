import type { Preview } from '@storybook/nextjs-vite';

import '../src/app/globals.css';

const preview: Preview = {
  parameters: {
    a11y: {
      test: 'error',
    },
    backgrounds: {
      default: 'canvas',
      values: [
        { name: 'canvas', value: '#f3f0e8' },
        { name: 'surface', value: '#ffffff' },
        { name: 'inverse', value: '#262b27' },
      ],
    },
    controls: {
      expanded: true,
    },
    layout: 'padded',
    nextjs: {
      appDirectory: true,
    },
  },
  tags: ['autodocs'],
};

export default preview;
