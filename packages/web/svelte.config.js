import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		warningFilter: (warning) => !warning.code.startsWith('a11y')
	},
	kit: {
		adapter: adapter({
			fallback: 'index.html'
		})
	}
};

export default config;
