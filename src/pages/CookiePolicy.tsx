import SEO from "@/components/SEO";
import { Cookie, Settings2, BarChart3, Mail } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * Cookie / local-storage notice. Deliberately describes what this site
 * ACTUALLY stores today rather than a generic template -- see the
 * localStorage.setItem/getItem call sites in LocaleContext.tsx (language +
 * currency preference) and the Supabase JS client (auth session, also
 * localStorage rather than a classic cookie). analytics.ts pushes events to
 * window.dataLayer in the standard GTM/GA4 shape, but no GTM/gtag.js script
 * is loaded on the site yet -- so there is currently no third-party
 * analytics or advertising cookie active. The consent banner is wired to
 * push Google Consent Mode v2 signals regardless, so a GA4/Ads tag can be
 * added later without a second privacy rollout.
 */
const Section = ({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) => (
  <section className="card-flat p-6 md:p-8">
    <div className="flex items-center gap-3 mb-4">
      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
      <h2 className="font-display font-extrabold text-xl">{title}</h2>
    </div>
    <div className="text-sm text-muted-foreground leading-relaxed space-y-3">{children}</div>
  </section>
);

const CookiePolicy = () => (
  <div className="container mx-auto px-4 py-12 max-w-4xl">
    <SEO
      title="Cookie Policy"
      description="What cookies and local storage AI Smart Store actually uses, and how to control them."
    />

    <div className="mb-10 text-center">
      <h1 className="text-4xl font-display font-extrabold tracking-tight mb-3">Cookie Policy</h1>
      <p className="text-muted-foreground max-w-2xl mx-auto">
        This page lists exactly what we store in your browser today — no boilerplate list of things we don't
        actually use.
      </p>
    </div>

    <div className="grid gap-5">
      <Section icon={<Cookie className="h-5 w-5" />} title="Strictly necessary">
        <p>These are required for the site to function and can't be switched off:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Sign-in session</strong> — kept in your browser's local storage by Supabase (our authentication provider) so you stay signed in between visits.</li>
          <li><strong>Language &amp; currency preference</strong> — your selected locale, stored locally so it persists across pages.</li>
          <li><strong>Cookie preference</strong> — the choice you make in the consent banner below, so we don't ask again every visit.</li>
        </ul>
      </Section>

      <Section icon={<BarChart3 className="h-5 w-5" />} title="Analytics">
        <p>
          We record first-party interaction events (page views, filter usage, search) to a standard data layer on
          this site so we can understand how the store is used. No third-party analytics or advertising cookie is
          currently active — if we add Google Analytics or Google Ads in future, it will read the same consent
          signal you set below (built to the Google Consent Mode v2 standard) rather than requiring a separate
          opt-in flow.
        </p>
      </Section>

      <Section icon={<Settings2 className="h-5 w-5" />} title="Your choices">
        <p>
          Use the cookie banner on your first visit, or the link in the footer at any time, to accept or decline
          non-essential storage. You can also clear cookies/local storage from your browser settings at any time —
          doing so will sign you out and reset your language preference.
        </p>
      </Section>

      <Section icon={<Mail className="h-5 w-5" />} title="Questions">
        <p>
          See our <Link to="/compliance" className="text-primary underline">Privacy &amp; POPIA</Link> page for how
          we handle personal information more broadly, or email{" "}
          <a className="text-primary underline" href="mailto:privacy@aismartstore.co.za">privacy@aismartstore.co.za</a>.
        </p>
      </Section>

      <p className="text-xs text-muted-foreground text-center mt-4">
        Last updated: {new Date().toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" })}.
      </p>
    </div>
  </div>
);

export default CookiePolicy;
