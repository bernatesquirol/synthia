import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * GitHub Pages serves no history fallback: a request for /performance has no
 * matching file and 404s. Pages does serve 404.html for unknown paths, so an
 * identical copy of index.html boots the router and it resolves the path
 * itself. Vite's dev server already falls back to index.html, so this is only
 * needed for the built site.
 */
function pagesSpaFallback(): Plugin {
  let outDir = "dist";
  return {
    name: "pages-spa-fallback",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const index = resolve(outDir, "index.html");
      if (existsSync(index)) copyFileSync(index, resolve(outDir, "404.html"));
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // The project page lives at bernatesquirol.github.io/synthia/. Dev keeps the
  // root so local URLs stay short.
  base: command === "build" ? "/synthia/" : "/",
  plugins: [pagesSpaFallback()],
  // localStorage is keyed to the origin, port included, so a performance
  // saved from one port is invisible from another. `strictPort` makes a busy
  // port an error instead of letting Vite quietly move to 8081 and appear to
  // have lost the work, and preview shares the port so the built site reads
  // the same saved performances as the dev server.
  server: {
    port: 8080,
    strictPort: true,
    open: true,
  },
  preview: {
    port: 8080,
    strictPort: true,
  },
}));
