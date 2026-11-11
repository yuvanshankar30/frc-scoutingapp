import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		// The scouting forms live in a root-level folder, one subfolder per game (see scouting-forms/README.md).
		alias: { $forms: 'scouting-forms' }
	}
};

export default config;
