import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { compression } from 'vite-plugin-compression2';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		compression({ algorithm: 'gzip', exclude: [/\.(br|gz)$/] }),
		compression({ algorithm: 'brotliCompress', exclude: [/\.(br|gz)$/] }),
	],
	server: {
		proxy: {
			'/api': 'http://localhost:3000'
		}
	},
	build: {
		cssMinify: 'lightningcss',
		minify: 'esbuild',
		target: 'es2020',
	},
	esbuild: {
		drop: ['console', 'debugger'],
		legalComments: 'none',
	},
});
