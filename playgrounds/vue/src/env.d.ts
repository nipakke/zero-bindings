/**
 * Vue SFC shim: the playground is type-checked with plain `tsc`, which cannot
 * read `.vue` internals. Template/type errors inside components are caught by
 * `@vitejs/plugin-vue` at build time and by the dev server as you edit.
 */
declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent;
  export default component;
}
