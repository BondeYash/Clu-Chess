import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: '#f3f0e8',
    description: 'Focused, server-authoritative chess.',
    display: 'standalone',
    name: 'Cluchess',
    short_name: 'Cluchess',
    start_url: '/',
    theme_color: '#f3f0e8',
  };
}
