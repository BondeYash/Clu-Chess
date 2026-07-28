import bundleAnalyzer from '@next/bundle-analyzer';
import type { NextConfig } from 'next';

import { parseFrontendEnvironment } from './src/config/environment.schema';

parseFrontendEnvironment(process.env);

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  compress: true,
  output: 'standalone',
  outputFileTracingRoot: import.meta.dirname,
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@cluchess/protocol-v1'],
  turbopack: {
    root: import.meta.dirname,
  },
  typedRoutes: true,
};

export default bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
})(nextConfig);
