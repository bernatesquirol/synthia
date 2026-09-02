const DEFAULT_PARAM = "v";

/**
 * Read and write the version param.
 *
 * Upstream this operated on `location.hash` because that app used a
 * HashRouter. This one routes on the path and already carries state in the
 * query string (`/performance?id=...`), so the param lives in
 * `location.search`. Reads still fall back to the hash so links produced by
 * the other placement resolve.
 */
function hashParams(): URLSearchParams {
  const raw = window.location.hash.replace(/^#/, "");
  const q = raw.indexOf("?");
  return new URLSearchParams(q === -1 ? "" : raw.slice(q + 1));
}

export function readVersionFromUrl(param = DEFAULT_PARAM): string | null {
  if (typeof window === "undefined") return null;
  const fromSearch = new URLSearchParams(window.location.search).get(param);
  if (fromSearch) return fromSearch;
  return hashParams().get(param);
}

export function writeVersionToUrl(
  hash: string | null,
  param = DEFAULT_PARAM,
): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (hash) url.searchParams.set(param, hash);
  else url.searchParams.delete(param);
  window.history.replaceState({}, "", url.toString());
}
