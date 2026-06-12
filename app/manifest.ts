import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TaminotWeb',
    short_name: 'TaminotWeb',
    description: 'Проверка товаров по накладной через сканер',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f3f4f6',
    theme_color: '#2563eb',
    lang: 'ru',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
