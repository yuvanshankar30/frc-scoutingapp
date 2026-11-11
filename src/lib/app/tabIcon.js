// The icon in the browser tab (Team settings > Browser tab icon). app.html starts with the app icon; the layout swaps
// in the team's choice once the team settings load, and Team settings previews unsaved choices the same way.
import { tabIconHref } from '$lib/app/appearance.js';

export function setTabIcon(href) {
  if (typeof document === 'undefined' || !href) return;
  let link = document.head.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') === href) return;
  link.removeAttribute('sizes');
  link.type = href.startsWith('data:image/svg') ? 'image/svg+xml' : '';
  if (!link.type) link.removeAttribute('type');
  link.href = href;
}

/** Shows the saved team's icon (the settings from the team store). */
export const showTeamTabIcon = (team) => {
  if (team) setTabIcon(tabIconHref(team.appearance, team, team.brandColor));
};
