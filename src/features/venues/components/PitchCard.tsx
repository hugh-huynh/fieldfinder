import Link from "next/link";

import { Pill } from "@/components/ui/Pill";
import type { PitchDto } from "@/features/pitches/dto";

import { pitchFacts } from "../pitch-facts";
import { pitchPath } from "../route-target";

// One published pitch on its venue's page (PR 3.10). The name links to the pitch page (3.11),
// stretched over the card, so each card is one link. Confirmed facts only.

export function PitchCard({ pitch }: { pitch: PitchDto }) {
  const facts = pitchFacts(pitch);
  return (
    <article className="group relative rounded-card border border-border p-4 transition-colors focus-within:bg-subtle hover:bg-subtle">
      <h3 className="text-base font-semibold text-ink">
        <Link
          href={pitchPath(pitch.venueSlug, pitch.slug)}
          className="rounded-sm group-focus-within:underline after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none"
        >
          {pitch.name}
        </Link>
      </h3>
      {facts.length > 0 ? (
        <ul aria-label="Pitch details" className="mt-2 flex flex-wrap gap-1.5">
          {facts.map((fact) => (
            <li key={fact}>
              <Pill>{fact}</Pill>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
