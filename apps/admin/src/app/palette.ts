import { ref } from 'vue';

// The ⌘K palette (CommandPalette.vue): open to search, or to switch to another community on the same page. Asked for
// from anywhere, the layout mounts it the first time
export const paletteMode = ref<'search' | 'switch'>();
