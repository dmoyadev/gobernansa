import process from 'node:process';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import vueDevTools from 'vite-plugin-vue-devtools';
import icons from '../../packages/shared/build/icons.ts';
import pageTexts from './pageTexts.ts';

export default defineConfig({
	envDir: '../..', // Both apps share the .env files at the root of the repo
	build: { sourcemap: 'hidden' }, // Maps to read production errors (MON-10), never linked from the code: CI keeps them apart and deploys without them
	resolve: {
		alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }, // Import from src as '@/...'
	},
	server: {
		// Photos from the Storage emulator, saved with relative addresses. npm run dev:isolated's is 20 above (scripts/demo.js)
		proxy: { '/v0/b': `http://127.0.0.1:${5504 + Number(process.env.VITE_EMULATORS_OFFSET ?? 0)}` },
	},
	plugins: [
		vue({
			template: {
				compilerOptions: {
					isCustomElement: tag => tag === 'iconify-icon', // Set the 'iconify-icon' tag as a web component
				},
			},
		}),
		icons(), // The icons the code uses, bundled: none is fetched from the internet
		mkcert(), // Use mkcert for enabling HTTPS in localhost
		vueDevTools(),
		pageTexts(), // The texts of the community pages, for its search
	],
});
