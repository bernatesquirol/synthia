import { parsePerformance, type Performance } from "./types";

const KEY_PREFIX = "synthgame.performance.";
const INDEX_KEY = "synthgame.performances";

/** Ids of every saved performance, most recently updated first. */
export function listPerformances(): { id: string; title: string }[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as { id: string; title: string }[];
  } catch {
    return [];
  }
}

export function save(performance: Performance): void {
  const doc: Performance = {
    ...performance,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(KEY_PREFIX + doc.id, JSON.stringify(doc));

  const label = doc.title || doc.youtubeId || doc.id;
  const index = listPerformances().filter((e) => e.id !== doc.id);
  index.unshift({ id: doc.id, title: label });
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export function load(id: string): Performance | null {
  const raw = localStorage.getItem(KEY_PREFIX + id);
  if (!raw) return null;
  try {
    return parsePerformance(JSON.parse(raw));
  } catch (err) {
    console.warn(`[storage] "${id}" is not readable`, err);
    return null;
  }
}

export function remove(id: string): void {
  localStorage.removeItem(KEY_PREFIX + id);
  const index = listPerformances().filter((e) => e.id !== id);
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

/** Most recently saved performance, for the viewer's default. */
export function loadLatest(): Performance | null {
  const [first] = listPerformances();
  return first ? load(first.id) : null;
}

export function downloadJson(performance: Performance): void {
  const name =
    (performance.title || performance.youtubeId || "performance")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "performance";

  const blob = new Blob([JSON.stringify(performance, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readJsonFile(file: File): Promise<Performance> {
  return parsePerformance(JSON.parse(await file.text()));
}
