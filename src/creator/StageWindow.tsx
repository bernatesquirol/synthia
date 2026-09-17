import { render, type ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

/** Where a popped-out stage opens, and under what name, if reused. */
export const STAGE_WINDOW = {
  name: "stage",
  features: "width=1024,height=640",
};

interface Props {
  /**
   * The window, already opened. Opening it is the caller's job because it has
   * to happen inside the click: a `window.open` from an effect has lost the
   * user gesture by the time it runs, and popup blockers say no.
   */
  win: Window;
  /** Called when the window goes away, by its own close box or ours. */
  onClose: () => void;
  children: ComponentChildren;
}

/**
 * Its own black window, so the piece can be watched instead of inspected.
 *
 * Everything that drives it stays in the creator — the clock, the transport,
 * the score — and this window holds only the picture. That is the point: put
 * it on the second screen, or full-screen it there, and the controls are
 * still to hand on the first one.
 *
 * It is a window rather than a fullscreen element because fullscreen would
 * take over the screen the creator is on, and rather than a second copy of
 * the app because there is only one clock: the same stage the creator renders
 * is rendered into this document, from the same state, on the same tick.
 */
export function StageWindow({ win, onClose, children }: Props) {
  /** The mount point inside the other document, once it exists. */
  const [host, setHost] = useState<HTMLElement | null>(null);
  // The setup effect must run once per window, so the callback reaches it
  // through a ref: a fresh arrow from the parent's render would otherwise
  // tear the window down and rebuild it on every clock tick.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const doc = win.document;
    doc.title = "Stage — performance creator";
    // A window under this name may already be open from a previous pop-out.
    doc.body.replaceChildren();
    copyStyles(document, doc);
    const own = doc.createElement("style");
    own.textContent = WINDOW_CSS;
    doc.head.appendChild(own);

    const mount = doc.createElement("div");
    mount.className = "stage-window";
    doc.body.appendChild(mount);
    setHost(mount);

    // Closing it is the user's prerogative, and no event for that fires
    // dependably in every browser, so watch from this side. The timer lives
    // here rather than over there, which cannot report its own death.
    const watch = window.setInterval(() => {
      if (win.closed) close.current();
    }, 400);
    // A reload of the creator would otherwise leave a frozen window behind.
    const orphan = () => win.close();
    window.addEventListener("pagehide", orphan);

    return () => {
      window.clearInterval(watch);
      window.removeEventListener("pagehide", orphan);
      render(null, mount);
      setHost(null);
      if (!win.closed) win.close();
    };
  }, [win]);

  // Re-rendered on every tick of the parent's clock, exactly as the inline
  // stage is; Preact diffs the other document's tree the same way.
  useEffect(() => {
    if (host) render(<>{children}</>, host);
  });

  return null;
}

/**
 * Whatever styles this document, however the bundler delivered it: a <link>
 * in the built app, injected <style> tags under the dev server. Cloned rather
 * than re-fetched, so the window needs no knowledge of either.
 */
function copyStyles(from: Document, to: Document) {
  const sheets = from.querySelectorAll('link[rel="stylesheet"], style');
  for (const sheet of Array.from(sheets)) {
    to.head.appendChild(sheet.cloneNode(true));
  }
}

/**
 * The window is nothing but the frame: black, centred, and as large as 16:9
 * fits whatever shape the window has been dragged into. The lyric is sized
 * against the frame rather than kept at its editing size, this being the one
 * place the piece is seen at performance scale.
 */
const WINDOW_CSS = `
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  .stage-window {
    display: grid;
    place-items: center;
    height: 100%;
  }
  .stage-window .stage {
    width: min(100vw, calc(100vh * 16 / 9));
    border-radius: 0;
  }
  .stage-window .stage-lyric {
    font-size: min(3.4vw, 6vh);
    padding: 6% 5% 4%;
  }
`;
