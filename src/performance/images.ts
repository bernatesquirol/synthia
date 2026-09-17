/**
 * Getting a photo from the desktop onto the beat grid: measure it, hash it,
 * name it. The upload itself goes through `RemoteStore.putAsset`, the same
 * path the backing track takes.
 */
import { hashBytes } from "../persistence";
import { DEFAULT_IMAGE_FIT, newId, type TimelineImage } from "./types";

export const IMAGE_ACCEPT = "image/*";

/** Photos are decoration, not masters; anything larger is a mistake. */
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

/** Beats a freshly dropped photo covers: one bar reads as a deliberate beat. */
export const DEFAULT_IMAGE_BARS = 1;

const MEASURE_TIMEOUT_MS = 15_000;

export interface PreparedImage {
  blob: Blob;
  /** Everything but the placement, which the drop position supplies. */
  fields: Omit<TimelineImage, "id" | "beat" | "beats" | "fit">;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (file.size === 0) throw new Error(`"${file.name}" is empty.`);
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB; the ` +
        `limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
    );
  }

  const bytes = await file.arrayBuffer();
  const mimeType = file.type || "image/jpeg";
  const blob = new Blob([bytes], { type: mimeType });

  // Measured through an <img>, which is also what will display it: a file
  // this element cannot decode is no use to us however valid it is.
  const size = await measureImage(blob);
  const hash = await hashBytes(bytes);

  return {
    blob,
    fields: {
      key: `images/${hash}${extensionFor(file, mimeType)}`,
      filename: file.name,
      mimeType,
      bytes: file.size,
      width: size.width,
      height: size.height,
    },
  };
}

export function placeImage(
  fields: PreparedImage["fields"],
  beat: number,
  beats: number,
): TimelineImage {
  return {
    ...fields,
    id: newId("img"),
    beat: Math.max(0, Math.round(beat)),
    beats: Math.max(1, Math.round(beats)),
    fit: DEFAULT_IMAGE_FIT,
  };
}

function measureImage(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();

    const finish = (fn: () => void) => {
      window.clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      URL.revokeObjectURL(url);
      fn();
    };
    img.onload = () =>
      finish(() => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          resolve({ width: img.naturalWidth, height: img.naturalHeight });
        } else {
          reject(new Error("That image has no readable size."));
        }
      });
    img.onerror = () =>
      finish(() => reject(new Error("This browser cannot open that image.")));
    const timer = window.setTimeout(
      () => finish(() => reject(new Error("Timed out reading that image."))),
      MEASURE_TIMEOUT_MS,
    );

    img.src = url;
  });
}

function extensionFor(file: File, mimeType: string): string {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1];
  if (fromName) return `.${fromName.toLowerCase()}`;
  const fromMime: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
  };
  return fromMime[mimeType] ?? ".img";
}

/** Image files out of a drop, ignoring whatever else came with it. */
export function imageFilesFrom(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  return Array.from(transfer.files).filter((f) => f.type.startsWith("image/"));
}
