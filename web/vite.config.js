// SvelteKit 3 takes its config here (no svelte.config.js). The web app lives in web/ (routes, lib, app.html,
// hooks.server.ts, static); the server code stays in ../src/. `npm run build` (at the repo root) runs vite HERE, in web/,
// and writes ../build/; src/server.ts imports build/handler.js and calls it with req.rs set (see hooks.server.ts).
// Why vite runs in web/ and the type-check config is called tsconfig.check.json: SvelteKit 3 reads a tsconfig.json in
// its working directory with the TypeScript 6 API, and this repo pins TypeScript 7, which does not have it.
// Shared code is imported as `#lib/...` (web/package.json "imports" maps it to web/lib/); SvelteKit 3 has no $lib option.
import { sveltekit } from "@sveltejs/kit/vite";
import adapter from "@sveltejs/adapter-node";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit({
    adapter: adapter({ out: "../build", precompress: false }),
    files: { routes: "routes", appTemplate: "app.html", assets: "static", hooks: { server: "hooks.server.ts" } },
    // SvelteKit's own origin check stays on: a cross-site form POST gets 403.
    csrf: { trustedOrigins: [] },
  })],
});
