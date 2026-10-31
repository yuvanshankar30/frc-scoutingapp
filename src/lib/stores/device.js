// Which layout the app is in. Phones get their own screens (not the desktop page squeezed), so
// pages branch on this: {#if $isPhone} phone markup {:else} desktop markup {/if}. 900px is the same
// switch the app shell uses for the bottom bar, so a page and the shell always agree.
import { readable } from 'svelte/store';

export const PHONE_QUERY = '(max-width: 900px)';

function mediaStore(query) {
  return readable(false, (set) => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const list = window.matchMedia(query);
    set(list.matches);
    const update = (event) => set(event.matches);
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  });
}

/** True on phone-sized screens (and narrow windows): render the phone layout. */
export const isPhone = mediaStore(PHONE_QUERY);
