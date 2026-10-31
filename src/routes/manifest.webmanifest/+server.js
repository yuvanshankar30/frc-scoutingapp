// The install manifest ("Add to Home Screen"), named and colored from Team settings.
import { json } from '@sveltejs/kit';
import { loadTeamSettings } from '$lib/server/teamSettings.js';

export async function GET() {
  const { settings } = await loadTeamSettings();
  const background = settings?.defaultTheme === 'light' ? '#f2f4f7' : '#0b1020';
  const icons = settings?.logoUrl
    ? [{ src: settings.logoUrl, sizes: 'any', purpose: 'any' }]
    : [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/favicon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
      ];
  return json(
    {
      name: settings?.appName || 'FRC Scouting',
      short_name: settings?.appShortName || 'Scouting',
      description: settings ? `Scouting and match analysis for FRC Team ${settings.teamNumber}` : 'FRC scouting',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: background,
      theme_color: background,
      icons,
      shortcuts: [
        {
          name: 'Scout a match',
          short_name: 'Scout',
          url: '/matchscout',
          icons: [{ src: '/icon-192.png', sizes: '192x192' }]
        },
        { name: 'My Reports', url: '/myscout', icons: [{ src: '/icon-192.png', sizes: '192x192' }] }
      ]
    },
    { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=300' } }
  );
}
