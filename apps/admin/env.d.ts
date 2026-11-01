/// <reference types="vite/client" />

declare module '*.vue' {
	import type { DefineComponent } from 'vue';

	const component: DefineComponent;
	export default component;
}

declare module 'virtual:page-texts' {
	// [text, tab as 'param=value' or the section, heading it's under]
	const pages: { path: string; title: string; texts: [string, string?, string?][] }[];
	export default pages;
}
