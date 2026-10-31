// Event data from The Blue Alliance is public and identical for every scout, so
// Vercel's edge can serve one shared copy for a few seconds instead of every
// phone in the stands waiting on its own trip to TBA. Errors are never cached.
export const PUBLIC_EVENT_CACHE = {
  'cache-control': 'public, max-age=0, s-maxage=20, stale-while-revalidate=120'
};
