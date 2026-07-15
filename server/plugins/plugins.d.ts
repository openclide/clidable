// The bundled `plugins` CLI entry has no type declarations; we import it only
// to run it (compiled-binary `__run-plugins` path — see cli.ts:runBundledPlugins).
declare module "plugins/dist/index.js";
