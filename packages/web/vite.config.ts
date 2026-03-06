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
			'/api': 'http://localhost:3000',
			'/ws': { target: 'ws://localhost:3000', ws: true },
		}
	},
	optimizeDeps: {
		include: [
			'lucide-svelte/icons/calendar',
			'lucide-svelte/icons/calendar-days',
			'lucide-svelte/icons/check-square',
			'lucide-svelte/icons/chevron-left',
			'lucide-svelte/icons/chevron-right',
			'lucide-svelte/icons/clock',
			'lucide-svelte/icons/eye',
			'lucide-svelte/icons/link',
			'lucide-svelte/icons/loader',
			'lucide-svelte/icons/map-pin',
			'lucide-svelte/icons/menu',
			'lucide-svelte/icons/panel-left-close',
			'lucide-svelte/icons/panel-left-open',
			'lucide-svelte/icons/refresh-cw',
			'lucide-svelte/icons/repeat',
			'lucide-svelte/icons/search',
			'lucide-svelte/icons/settings',
			'lucide-svelte/icons/target',
			'lucide-svelte/icons/trash-2',
			'lucide-svelte/icons/triangle-alert',
			'lucide-svelte/icons/users',
			'lucide-svelte/icons/x',
			'lucide-svelte/icons/bar-chart-3',
			'lucide-svelte/icons/ellipsis-vertical',
		],
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
