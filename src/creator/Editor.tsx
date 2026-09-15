import { useMemo, useState } from "preact/hooks";
import { loadConfig } from "../config";
import { RemoteStore } from "../performance/remote";
import type { Performance } from "../performance/types";
import { SourcePanel } from "./SourcePanel";
import { Workshop } from "./Workshop";

interface Props {
  performance: Performance;
  /**
   * Functional updates only. Handlers here can outlive the render that made
   * them, so spreading a captured `performance` would revert edits made in
   * between.
   */
  update: (fn: (previous: Performance) => Performance) => void;
}

export type Step = "source" | "workshop";

const STEPS: { id: Step; label: string; hint: string }[] = [
  {
    id: "source",
    label: "Source",
    hint: "The video, the original lyrics, the backing track",
  },
  {
    id: "workshop",
    label: "Workshop",
    hint: "Rewrite the lyrics, put photos on the beats",
  },
];

/**
 * Authoring is two passes, and they want different things on screen.
 *
 * Step 1 gathers source material against the YouTube video: the link, the
 * lyrics it sings, the audio to play instead of it. Step 2 drops the video
 * entirely and works on the piece itself, on the backing track's clock. They
 * are separate screens because almost nothing on one is useful on the other,
 * and because the two run on different clocks.
 */
export function Editor({ performance, update }: Props) {
  const [step, setStep] = useState<Step>("source");
  const remote = useMemo(() => new RemoteStore(loadConfig()), []);

  return (
    <>
      <div class="steps">
        {STEPS.map((entry, i) => (
          <button
            key={entry.id}
            class={"step" + (step === entry.id ? " current" : "")}
            onClick={() => setStep(entry.id)}
          >
            <span class="step-n">{i + 1}</span>
            <span class="step-text">
              <strong>{entry.label}</strong>
              <span class="muted">{entry.hint}</span>
            </span>
          </button>
        ))}
      </div>

      {step === "source" ? (
        <SourcePanel performance={performance} update={update} />
      ) : (
        <Workshop performance={performance} update={update} remote={remote} />
      )}
    </>
  );
}
