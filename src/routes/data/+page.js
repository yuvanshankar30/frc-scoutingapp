import { redirect } from '@sveltejs/kit';

// Analyze > Data now lives in Data Viewer as its Rankings tab. Old links (with ?event_key= and ?metric=) still work.
export function load({ url }) {
  redirect(308, `/dataviewer/rankings${url.search}`);
}
