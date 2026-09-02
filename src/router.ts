/**
 * Minimal path router. Vite's dev server falls back to index.html for unknown
 * paths, so real URLs work without a hash. A static host needs the same
 * fallback rule for /performance and /performance_creator.
 */
export interface Route {
  path: string;
  load: () => Promise<{ mount: (root: HTMLElement) => void | Promise<void> }>;
}

export function normalisePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export async function startRouter(
  root: HTMLElement,
  routes: Route[],
  fallback: Route,
): Promise<void> {
  const path = normalisePath(window.location.pathname);
  const route = routes.find((r) => r.path === path) ?? fallback;
  const mod = await route.load();
  await mod.mount(root);
}

/** Navigate without a full reload. */
export function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.location.reload();
}
