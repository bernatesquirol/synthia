const DEFAULT_PARAM = "v";

// The app uses a HashRouter, so the active route — and any query params that
// belong to it — live inside `location.hash` (e.g. `#/flow/wiki?v=abc`), not in
// `location.search` (which sits before the `#`). These helpers therefore read
// and write the version param inside the hash, consistent with react-router's
// own `useSearchParams`. Reads fall back to `location.search` so links produced
// by the older placement (`?v=…#/flow/wiki`) still resolve.

// Split a hash like `#/flow/wiki?v=abc` into its path and its query params.
function parseHash(): { path: string; params: URLSearchParams } {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const qIndex = raw.indexOf("?");
  if (qIndex === -1) return { path: raw, params: new URLSearchParams() };
  return {
    path: raw.slice(0, qIndex),
    params: new URLSearchParams(raw.slice(qIndex + 1)),
  };
}

export function readVersionFromUrl(param = DEFAULT_PARAM): string | null {
  if (typeof window === "undefined") return null;
  const fromHash = parseHash().params.get(param);
  if (fromHash) return fromHash;
  // Legacy placement: `?v=…` before the `#`.
  return new URLSearchParams(window.location.search).get(param);
}

export function writeVersionToUrl(
  hash: string | null,
  param = DEFAULT_PARAM,
): void {
  if (typeof window === "undefined") return;
  const { path, params } = parseHash();
  if (hash) params.set(param, hash);
  else params.delete(param);
  const qs = params.toString();
  const newHash = "#" + path + (qs ? "?" + qs : "");
  // Drop any legacy `?v=` left in location.search so we don't keep two copies.
  const url = new URL(window.location.href);
  url.searchParams.delete(param);
  window.history.replaceState(
    {},
    "",
    url.origin + url.pathname + url.search + newHash,
  );
}
