import type { StorybookConfig } from '@storybook/nextjs-vite';

const config: StorybookConfig = {
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/nextjs-vite',
    options: {},
  },
  stories: ['../src/**/*.stories.@(ts|tsx)'],
};

export default config;
