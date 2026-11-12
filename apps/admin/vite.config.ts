import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import vueDevTools from 'vite-plugin-vue-devtools';
import pageTexts from './pageTexts.ts';

const GOOGLE_FONTS_IMPORT = /@import\s*["']https:\/\/fonts\.googleapis\.com[^"']*["'];?/g;

export default defineConfig({
	envDir: '../..', // Both apps share the .env files at the root of the repo
	build: { sourcemap: 'hidden' }, // Maps to read production errors (MON-10), never linked from the code: CI keeps them apart and deploys without them
	resolve: {
		alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }, // Import from src as '@/...'
	},
	plugins: [
		// lnxjs-components' base.css imports Google Fonts the theme replaces (typography.scss): dropped, so no IP reaches Google
		{
			name: 'drop-google-fonts',
			enforce: 'pre',
			transform: (code, id) => id.includes('lnxjs-components/dist/base.css') ? code.replace(GOOGLE_FONTS_IMPORT, '') : undefined,
		},
		vue({
			template: {
				compilerOptions: {
					isCustomElement: tag => tag === 'iconify-icon', // Set the 'iconify-icon' tag as a web component
				},
			},
		}),
		mkcert(), // Use mkcert for enabling HTTPS in localhost
		vueDevTools(),
		pageTexts(), // The texts of the community pages, for its search
	],
});
