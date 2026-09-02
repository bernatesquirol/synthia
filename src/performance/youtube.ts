/**
 * Thin wrapper over the YouTube IFrame Player API. The creator needs the
 * player's clock to stamp lyric timings, and the viewer needs it to drive
 * playback, so both go through here.
 */

/** The subset of the IFrame API we rely on. */
export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  loadVideoById(videoId: string): void;
  destroy(): void;
}

export const PLAYER_STATE = {
  unstarted: -1,
  ended: 0,
  playing: 1,
  paused: 2,
  buffering: 3,
  cued: 5,
} as const;

interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: Record<string, unknown>,
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeApi> | null = null;

export function loadYouTubeApi(): Promise<YouTubeApi> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    window.onYouTubeIframeAPIReady = () => {
      if (window.YT) resolve(window.YT);
      else reject(new Error("YouTube API loaded without a Player"));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => reject(new Error("Could not load the YouTube API"));
    document.head.appendChild(script);
  });
  return apiPromise;
}

export interface PlayerHandlers {
  onReady?: (player: YouTubePlayer) => void;
  onStateChange?: (state: number) => void;
}

export async function createPlayer(
  element: HTMLElement,
  videoId: string,
  handlers: PlayerHandlers = {},
): Promise<YouTubePlayer> {
  const api = await loadYouTubeApi();
  return new Promise((resolve) => {
    const player = new api.Player(element, {
      videoId,
      playerVars: {
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
      },
      events: {
        onReady: () => {
          handlers.onReady?.(player);
          resolve(player);
        },
        onStateChange: (e: { data: number }) =>
          handlers.onStateChange?.(e.data),
      },
    });
  });
}

/**
 * Pull the video id out of any of the URL shapes people paste, or accept a
 * bare 11-character id.
 */
export function parseYouTubeId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^[\w-]{11}$/.test(text)) return text;

  let url: URL;
  try {
    url = new URL(text.startsWith("http") ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    const v = url.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    // /embed/ID, /shorts/ID, /live/ID
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts[1];
    if (id && /^[\w-]{11}$/.test(id)) return id;
  }
  return null;
}

export interface OEmbedInfo {
  title: string;
  author: string;
}

/**
 * YouTube's oEmbed endpoint reflects the request Origin, so this works from the
 * browser without a proxy. Used only to prefill the title/artist fields.
 */
export async function fetchVideoInfo(videoId: string): Promise<OEmbedInfo> {
  const target = encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`,
  );
  const res = await fetch(
    `https://www.youtube.com/oembed?url=${target}&format=json`,
  );
  if (!res.ok) throw new Error(`Could not read video info (${res.status})`);
  const data = (await res.json()) as { title?: string; author_name?: string };
  return { title: data.title ?? "", author: data.author_name ?? "" };
}

/**
 * Video titles are usually "Artist - Track (Official Video)". Strip the noise
 * so the lyrics lookup has a decent first guess.
 */
export function guessTrackAndArtist(
  title: string,
  author: string,
): { track: string; artist: string } {
  const cleaned = title
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(official|video|audio|lyrics?|hd|4k|remaster(ed)?|mv)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const dash = cleaned.split(/\s[-–—]\s/);
  if (dash.length >= 2) {
    return { artist: dash[0].trim(), track: dash.slice(1).join(" - ").trim() };
  }
  return { artist: author.replace(/\s*-\s*Topic$/, "").trim(), track: cleaned };
}
