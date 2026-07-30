import SEO from "@/components/SEO";
import { Shield, FileText, Mail, Scale, Lock } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * POPIA & PAIA compliance page.
 *
 * POPIA = Protection of Personal Information Act, 4 of 2013 (South Africa).
 * PAIA  = Promotion of Access to Information Act, 2 of 2000 (South Africa).
 *
 * Both statutes require us to publish, in plain language, what personal
 * information we collect, why, how it is protected, and how a data subject
 * can access, correct, or delete it. This page is that public disclosure.
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

const Compliance = () => (
  <div className="container mx-auto px-4 py-12 max-w-4xl">
    <SEO
      title="POPIA & PAIA Compliance"
      description="AI Smart Store is fully compliant with South Africa's POPIA and PAIA legislation. Learn how we protect and handle your personal information."
    />

    <div className="mb-10 text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-display font-bold border border-emerald-200 mb-4">
        <Shield className="h-3.5 w-3.5" /> POPIA & PAIA Compliant
      </div>
      <h1 className="text-4xl font-display font-extrabold tracking-tight mb-3">Privacy & Access to Information</h1>
      <p className="text-muted-foreground max-w-2xl mx-auto">
        AI Smart Store is a South African company and is fully compliant with the{" "}
        <strong>Protection of Personal Information Act (POPIA)</strong> and the{" "}
        <strong>Promotion of Access to Information Act (PAIA)</strong>.
      </p>
    </div>

    <div className="grid gap-5">
      <Section icon={<FileText className="h-5 w-5" />} title="What we collect">
        <p>
          We collect only what is necessary to fulfil your order and operate our platform: your name, email, phone
          number, shipping address, order history, and payment confirmation from our payment provider (Yoco/PayPal).
          We do <strong>not</strong> store your card number or CVV — that data lives with the payment gateway.
        </p>
      </Section>

      <Section icon={<Lock className="h-5 w-5" />} title="How we protect it">
        <p>
          All traffic is encrypted with TLS. Data is stored in Supabase (EU/US regions) behind strict row-level
          security policies, meaning a customer can only ever read their own records. Payment card data never touches
          our servers. Admin access is protected by role-based access control and audited.
        </p>
      </Section>

      <Section icon={<Scale className="h-5 w-5" />} title="Your rights under POPIA">
        <p>You have the right, at any time and free of charge, to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Access the personal information we hold about you</li>
          <li>Correct or update inaccurate information</li>
          <li>Request deletion of your account and personal data</li>
          <li>Object to direct marketing (unsubscribe links are on every newsletter)</li>
          <li>Lodge a complaint with the Information Regulator of South Africa</li>
        </ul>
        <p>
          To exercise any of these rights, email us at{" "}
          <a className="text-primary underline" href="mailto:privacy@aismartstore.co.za">privacy@aismartstore.co.za</a>.
        </p>
      </Section>

      <Section icon={<FileText className="h-5 w-5" />} title="PAIA Manual">
        <p>
          In line with section 51 of PAIA, our Information Officer maintains a PAIA Manual describing the records held
          by AI Smart Store and the procedure for requesting access. To request a copy of the manual or to submit a
          Form 2 access request, contact the Information Officer below.
        </p>
      </Section>

      <Section icon={<Mail className="h-5 w-5" />} title="Information Officer">
        <p>
          <strong>Fernando Steyn</strong><br />
          Information Officer, AI Smart Store<br />
          Email: <a className="text-primary underline" href="mailto:privacy@aismartstore.co.za">privacy@aismartstore.co.za</a><br />
          Response time: within 30 days of a written request, per POPIA s.23.
        </p>
        <p className="text-xs pt-2">
          Regulator: <a className="text-primary underline" href="https://inforegulator.org.za" target="_blank" rel="noopener noreferrer">Information Regulator of South Africa</a>
        </p>
      </Section>

      <p className="text-xs text-muted-foreground text-center mt-4">
        Last updated: {new Date().toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" })}. See also our <Link className="underline" to="/">homepage</Link>.
      </p>
    </div>
  </div>
);

export default Compliance;
