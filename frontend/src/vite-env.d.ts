/// <reference types="vite/client" />

declare const __BEAT_INCLUDE_INTERNAL_TEST_BANKS__: boolean;

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
