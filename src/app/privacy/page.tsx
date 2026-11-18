import type { Metadata } from "next";

import { AnalyticsChoice } from "@/features/analytics/components/AnalyticsChoice";
import { LegalPage, Section } from "@/features/legal/components/LegalPage";

// /privacy (PR 4.1): the privacy policy and collection notice (APP 1, APP 5), and the place to change
// the analytics choice. Draft wording for review (plan P5). Every statement here describes what the
// code does; keep them in step (ADR-0005 location privacy, src/features/analytics).

export const metadata: Metadata = {
  title: "Privacy · FieldFinder",
  description: "What FieldFinder collects, why, and the choices you have.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy">
      <Section id="short" title="The short version">
        <ul>
          <li>There are no accounts. We don&rsquo;t ask for your name, email or phone number.</li>
          <li>Your exact location never leaves your device.</li>
          <li>Analytics is off unless you allow it, and you can change your mind below at any time.</li>
          <li>We don&rsquo;t sell information or use it for advertising.</li>
        </ul>
      </Section>

      <Section id="who" title="Who we are">
        <p>FieldFinder is run by [operator name]. For anything about privacy, contact us at [contact email].</p>
      </Section>

      <Section id="location" title="Your location">
        <p>
          If you press &ldquo;Use my location&rdquo;, your browser asks for your permission first. Your exact position
          stays on your device, where it&rsquo;s used to show how far away each field is.
        </p>
        <p>
          To find fields near you and name your suburb, we use your position rounded to about 1&nbsp;km. That rounded
          position is sent to our server, which asks our map provider, Mapbox, for the suburb&rsquo;s name. It also
          appears in the page address, so you can bookmark or share a search. We don&rsquo;t store it.
        </p>
      </Section>

      <Section id="searching" title="Searching for a place">
        <p>
          What you type in the search box is sent to our server and passed to Mapbox to suggest matching places. The
          place you choose, and its map position, appear in the page address. We don&rsquo;t store your searches.
        </p>
      </Section>

      <Section id="analytics" title="Analytics, only if you allow it">
        <p>
          With your permission, we use Google Analytics to understand which pages and features are used, so we can
          improve FieldFinder. It receives:
        </p>
        <ul>
          <li>the pages you view, without the place you searched or any map position;</li>
          <li>
            the kind of search (a place, your location, or a map area), which filters are on, and how many fields were
            found;
          </li>
          <li>which venue and pitch pages you open, and when you choose a map marker or ask for directions;</li>
          <li>
            details Google collects automatically: your browser, device and screen size, and an approximate region
            worked out from your internet address.
          </li>
        </ul>
        <p>
          Google Analytics never receives your exact location, what you type, or the address of a search. It sets
          cookies named <code>_ga</code> and <code>_ga_…</code>, kept for up to 13 months. We&rsquo;ve turned off
          Google&rsquo;s advertising features and Google signals. Google handles this information under its own{" "}
          <a href="https://policies.google.com/privacy" rel="noopener noreferrer">
            privacy policy
          </a>
          .
        </p>
        <div className="mt-4">
          <AnalyticsChoice />
        </div>
        <p>Turning analytics off stops it straight away and removes its cookies from this browser.</p>
      </Section>

      <Section id="providers" title="Services that handle information for us">
        <ul>
          <li>
            <strong>Hosting (Vercel)</strong> delivers every page. Like any website host, it receives your internet
            address and the pages you ask for, and we use this to keep the site working and to block abuse, such as
            automated copying. [Retention period to confirm.]
          </li>
          <li>
            <strong>Maps (Mapbox).</strong> Your browser loads the map directly from Mapbox, which receives your
            internet address and the map area shown. The map may keep copies of map images in your browser&rsquo;s
            cache.
          </li>
          <li>
            <strong>Directions (Google Maps).</strong> &ldquo;Get directions&rdquo; opens Google Maps with the
            field&rsquo;s location. What happens there is covered by Google&rsquo;s privacy policy.
          </li>
        </ul>
        <p>
          These providers may handle information outside Australia, including in the United States. [Confirm each
          provider&rsquo;s regions.]
        </p>
      </Section>

      <Section id="device" title="What’s kept on your device">
        <ul>
          <li>Your analytics choice, in your browser&rsquo;s local storage.</li>
          <li>Google Analytics cookies, only if you allow analytics.</li>
        </ul>
      </Section>

      <Section id="contact" title="Questions and complaints">
        <p>
          We don&rsquo;t hold information that identifies you, but if you have a question or a complaint about how we
          handle information, contact us at [contact email]. We&rsquo;ll respond within 30 days. If you&rsquo;re not
          satisfied with our response, you can contact the{" "}
          <a href="https://www.oaic.gov.au/" rel="noopener noreferrer">
            Office of the Australian Information Commissioner
          </a>
          .
        </p>
      </Section>

      <Section id="changes" title="Changes to this policy">
        <p>If we change how we handle information, we&rsquo;ll update this page and its date.</p>
      </Section>
    </LegalPage>
  );
}
