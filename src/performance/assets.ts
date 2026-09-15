/**
 * Binary attachments — backing audio and timeline photos — share one storage
 * path and one cache. Both are content-addressed objects under the
 * performance's own prefix, fetched whole and handed to the DOM as blob URLs.
 *
 * Fetching whole rather than pointing an element at the presigned URL is
 * deliberate: presigned URLs expire, so a range request made after they do
 * would stall a song mid-playback, and a blob lets us set the MIME type
 * ourselves instead of trusting whatever the bucket recorded at upload time.
 */
import { useEffect, useState } from "preact/hooks";
import type { RemoteStore } from "./remote";

/**
 * Keyed by `<performanceId>/<key>`. Keys are content hashes, so an entry can
 * never be stale. Module scope means an upload can seed the cache and play
 * back with no round trip, and remounting a screen costs nothing.
 */
const blobs = new Map<string, Promise<Blob | null>>();

function cacheId(performanceId: string, key: string): string {
  return `${performanceId}/${key}`;
}

/** Seed the cache with bytes we already hold, right after uploading them. */
export function cacheAsset(
  performanceId: string,
  key: string,
  blob: Blob,
): void {
  blobs.set(cacheId(performanceId, key), Promise.resolve(blob));
}

export function loadAsset(
  remote: RemoteStore,
  performanceId: string,
  key: string,
): Promise<Blob | null> {
  const id = cacheId(performanceId, key);
  const hit = blobs.get(id);
  if (hit) return hit;
  const pending = remote.getAsset(performanceId, key).catch((err) => {
    // A failed fetch must not be remembered, or a retry could never work.
    blobs.delete(id);
    throw err;
  });
  blobs.set(id, pending);
  return pending;
}

/**
 * Blob URLs for a set of keys, held for as long as the caller is mounted.
 *
 * Every photo is resolved up front rather than as each one comes on screen:
 * a slideshow that fetched at the moment of the cut would flash a gap on
 * every change, and a performance's worth of photos is a handful of files.
 */
export function useAssetUrls(
  performanceId: string,
  assets: { key: string; mimeType: string }[],
  remote: RemoteStore,
): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  // A stable description of the set, so the effect re-runs when the keys
  // change but not when the caller rebuilds an equivalent array.
  const signature = assets.map((a) => a.key).join("|");

  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    const next = new Map<string, string>();
    if (assets.length === 0) {
      setUrls(new Map());
      return;
    }

    for (const asset of assets) {
      loadAsset(remote, performanceId, asset.key)
        .then((blob) => {
          if (cancelled || !blob) return;
          const url = URL.createObjectURL(
            asset.mimeType ? blob.slice(0, blob.size, asset.mimeType) : blob,
          );
          made.push(url);
          next.set(asset.key, url);
          // Published one at a time rather than once at the end, so a single
          // slow photo does not hold back every other photo on the timeline.
          setUrls(new Map(next));
        })
        // A photo that will not load leaves a gap rather than breaking the
        // rest of the slideshow.
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      for (const url of made) URL.revokeObjectURL(url);
    };
    // `assets` is rebuilt every render; the signature is what actually moves.
  }, [performanceId, signature, remote]);

  return urls;
}
