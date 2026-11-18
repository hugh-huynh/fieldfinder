import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage, Section } from "@/features/legal/components/LegalPage";

// /terms (PR 4.1): terms of use, including the data-reuse terms behind the scraping resistance
// (spec §6) and the map and photo credits. Draft wording for review (plan P5).

export const metadata: Metadata = {
  title: "Terms of use · FieldFinder",
  description: "The terms for using FieldFinder and its information about soccer fields.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <Section id="about" title="About FieldFinder">
        <p>
          FieldFinder is a free guide to public soccer fields, run by [operator name]. By using it, you agree to these
          terms.
        </p>
      </Section>

      <Section id="accuracy" title="Check before you go">
        <p>
          We gather field information carefully, but it can be incomplete or out of date. Where we don&rsquo;t know
          something, we say &ldquo;Not confirmed&rdquo; rather than guess. Fields are run by councils, schools and
          clubs, who set their own rules on access, bookings and opening times. Check signs on site, or with the
          field&rsquo;s owner, before you rely on them. FieldFinder doesn&rsquo;t take bookings.
        </p>
      </Section>

      <Section id="use" title="Using the information">
        <p>You&rsquo;re welcome to use FieldFinder to find somewhere to play, and to share links to its pages.</p>
        <p>You must not:</p>
        <ul>
          <li>
            copy FieldFinder&rsquo;s field information or photos in bulk, by hand or by automated means (scraping,
            crawling or downloading), or use them to build another directory, dataset or service;
          </li>
          <li>access the site with automated tools, except search engines following our robots rules;</li>
          <li>get around our security or the limits on how fast the site can be used.</li>
        </ul>
        <p>We may block access that breaks these terms.</p>
      </Section>

      <Section id="credits" title="Content and credits">
        <p>
          The field information and the site&rsquo;s own content belong to [operator name]. Photos show their credit and
          licence where one applies; reuse them only as that licence allows. Maps &copy; Mapbox &copy; OpenStreetMap
          contributors.
        </p>
      </Section>

      <Section id="links" title="Other websites">
        <p>
          Links such as &ldquo;Get directions&rdquo; open other websites, like Google Maps. We&rsquo;re not responsible
          for their content, and their own terms apply.
        </p>
      </Section>

      <Section id="liability" title="Our responsibility">
        <p>
          FieldFinder is provided as is. As far as the law allows, we&rsquo;re not liable for loss arising from your use
          of it or from information on it. Nothing in these terms excludes rights you have under the Australian Consumer
          Law that can&rsquo;t be excluded.
        </p>
      </Section>

      <Section id="general" title="General">
        <p>
          These terms are governed by the law of Victoria, Australia. We may update them; the date above shows when they
          last changed. Questions: [contact email]. For how we handle information, see our{" "}
          <Link href="/privacy">privacy policy</Link>.
        </p>
      </Section>
    </LegalPage>
  );
}
