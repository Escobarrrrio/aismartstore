import SEO from "@/components/SEO";
import { FileText, ShoppingCart, CreditCard, Truck, Shield, Scale, Mail } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * Terms of Service.
 *
 * Standard South African e-commerce terms consistent with the Consumer
 * Protection Act 68 of 2008 (CPA) and the Electronic Communications and
 * Transactions Act 25 of 2002 (ECTA). Payment, delivery, and returns
 * mechanics referenced here match what checkout/OrderTracking/
 * ShippingReturns actually do -- see those for the operational detail;
 * this page is the legal terms governing them.
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

const Terms = () => (
  <div className="container mx-auto px-4 py-12 max-w-4xl">
    <SEO
      title="Terms of Service"
      description="Terms and conditions governing purchases and account use on AI Smart Store."
    />

    <div className="mb-10 text-center">
      <h1 className="text-4xl font-display font-extrabold tracking-tight mb-3">Terms of Service</h1>
      <p className="text-muted-foreground max-w-2xl mx-auto">
        These terms govern your use of AI Smart Store (aismartstore.co.za) and any purchase made through it.
        By creating an account or placing an order, you agree to them.
      </p>
    </div>

    <div className="grid gap-5">
      <Section icon={<FileText className="h-5 w-5" />} title="1. Who we are">
        <p>
          AI Smart Store is operated by AI Job Chommie (Pty) Ltd, a South African company. These terms are governed
          by South African law, including the Consumer Protection Act 68 of 2008 (CPA) and the Electronic
          Communications and Transactions Act 25 of 2002 (ECTA).
        </p>
      </Section>

      <Section icon={<ShoppingCart className="h-5 w-5" />} title="2. Products, pricing and order acceptance">
        <p>
          Prices are shown in South African Rand and include VAT where applicable. We make reasonable efforts to
          keep product information, pricing and stock levels accurate, but errors can occur — a listing is an
          invitation to make an offer, not a binding offer on our part. We reserve the right to correct pricing or
          description errors, or to decline or cancel an order (with a full refund of anything already paid), before
          dispatch.
        </p>
        <p>
          Your order is only accepted once payment is confirmed and you receive an order confirmation. Until then,
          no contract of sale exists.
        </p>
      </Section>

      <Section icon={<CreditCard className="h-5 w-5" />} title="3. Payment">
        <p>
          Payments are processed by Yoco and/or PayPal, both PCI-DSS compliant payment providers. We never see or
          store your full card number — that data is handled entirely by the payment provider. All payments must
          clear before an order is dispatched.
        </p>
      </Section>

      <Section icon={<Truck className="h-5 w-5" />} title="4. Delivery and returns">
        <p>
          Delivery timeframes, fees, and our returns and refunds process (including your CPA section 56 rights on
          defective goods and our change-of-mind window) are set out in full on our{" "}
          <Link to="/shipping-returns" className="text-primary underline">Shipping &amp; Returns</Link> page, which
          forms part of these terms.
        </p>
      </Section>

      <Section icon={<Shield className="h-5 w-5" />} title="5. Your account">
        <p>
          You're responsible for keeping your account credentials confidential and for all activity under your
          account. Each person or business may hold only one account — this is enforced by unique constraints on ID
          number, phone number and VAT number. Notify us immediately at{" "}
          <a className="text-primary underline" href="mailto:support@aismartstore.co.za">support@aismartstore.co.za</a>{" "}
          if you suspect unauthorised access.
        </p>
        <p>
          Business/Government accounts unlock the enterprise catalogue and compliance pack on the strength of the
          information provided at signup being accurate. We may request supporting documentation before extending
          net-terms or high-value orders.
        </p>
      </Section>

      <Section icon={<Scale className="h-5 w-5" />} title="6. Intellectual property &amp; acceptable use">
        <p>
          All content on this site — text, images, logos, and the underlying software — belongs to AI Smart Store or
          its licensors and may not be reproduced without permission. You may not use the site to submit false
          information, attempt to circumvent security controls, scrape the catalogue at scale, or resell access to
          the platform itself.
        </p>
      </Section>

      <Section icon={<Shield className="h-5 w-5" />} title="7. Limitation of liability">
        <p>
          To the extent permitted by law, AI Smart Store's liability for any claim arising from your use of the site
          or a purchase is limited to the value of the relevant order. We are not liable for indirect or
          consequential loss. Nothing in these terms limits any right you have under the CPA that cannot lawfully be
          excluded.
        </p>
      </Section>

      <Section icon={<FileText className="h-5 w-5" />} title="8. Changes to these terms">
        <p>
          We may update these terms from time to time to reflect changes in the law or how the platform operates.
          The date below shows when they were last revised. Continuing to use the site after an update means you
          accept the revised terms.
        </p>
      </Section>

      <Section icon={<Mail className="h-5 w-5" />} title="9. Contact &amp; disputes">
        <p>
          Questions or complaints: <a className="text-primary underline" href="mailto:support@aismartstore.co.za">support@aismartstore.co.za</a>.
          These terms are governed by the laws of South Africa, and any dispute not resolved directly may be referred
          to the National Consumer Commission or a competent South African court.
        </p>
      </Section>

      <p className="text-xs text-muted-foreground text-center mt-4">
        Last updated: {new Date().toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" })}. See also our{" "}
        <Link className="underline" to="/compliance">Privacy &amp; POPIA</Link> and{" "}
        <Link className="underline" to="/cookies">Cookie</Link> policies.
      </p>
    </div>
  </div>
);

export default Terms;
