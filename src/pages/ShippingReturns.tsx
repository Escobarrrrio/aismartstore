import SEO from "@/components/SEO";
import { Truck, PackageSearch, Building2, RotateCcw, ClipboardList, Mail, Shield } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * Shipping, delivery and returns policy.
 *
 * The change-of-mind return window (30 days) is a store policy choice that
 * exceeds the Consumer Protection Act's baseline 5-business-day direct
 * marketing cooling-off right (CPA s.16) -- matching the standard South
 * African online retail convention. The defective-goods guarantee mirrors
 * the CPA s.56 implied warranty of quality (repair/replace/refund within
 * 6 months of delivery). Distribution partners and dispatch origin match
 * what's actually wired up in the store (Axiz via axiz-sync; NMBM dispatch;
 * The Courier Guy for outbound delivery) -- Pinnacle and Tarsus are named
 * as accredited backup sourcing partners, not claimed as separately
 * API-integrated, since only Axiz is.
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

const ShippingReturns = () => (
  <div className="container mx-auto px-4 py-12 max-w-4xl">
    <SEO
      title="Shipping & Returns"
      description="Delivery timeframes, order tracking, and our returns policy for AI Smart Store — South Africa-wide courier delivery via The Courier Guy."
      path="/shipping-returns"
    />

    <div className="mb-10 text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-display font-bold border border-primary/20 mb-4">
        <Truck className="h-3.5 w-3.5" /> Shipping & Returns Policy
      </div>
      <h1 className="text-4xl font-display font-extrabold tracking-tight mb-3">Delivery, Tracking & Returns</h1>
      <p className="text-muted-foreground max-w-2xl mx-auto">
        What to expect from dispatch to delivery, and how returns and refunds work if something isn't right.
      </p>
    </div>

    <div className="grid gap-5">
      <Section icon={<Truck className="h-5 w-5" />} title="Delivery">
        <p>
          Every order ships nationwide via <strong>The Courier Guy</strong>, dispatched from our fulfilment point
          in Gqeberha (Nelson Mandela Bay). Typical delivery is <strong>2–5 business days</strong>, depending on
          your province — metro areas (Gauteng, Western Cape) tend to arrive fastest, with regional and outlying
          areas taking a little longer.
        </p>
        <p>
          Your exact shipping fee is calculated automatically at checkout from your delivery province and parcel
          weight — never a flat guess. If an item is temporarily out of stock, it's shown honestly as a backorder
          on the product page rather than hidden; backordered items typically ship within 3–7 days once
          replenished.
        </p>
      </Section>

      <Section icon={<PackageSearch className="h-5 w-5" />} title="Order tracking">
        <p>
          Once your order is handed to the courier, you'll get an email with your tracking number and a link to
          your order's live status page in your account — showing exactly where it stands: placed, paid, shipped,
          or delivered.
        </p>
        <p>
          That page is our authoritative record of your order status. For scan-by-scan delivery events (depot
          arrivals, out-for-delivery), it links directly to The Courier Guy's own tracking system — they're the
          ones physically moving the parcel, so their system is the source of truth for that level of detail.
        </p>
        <p>
          You can find every order and its tracking link under{" "}
          <Link to="/account" className="text-primary underline">My Account → Orders</Link> at any time.
        </p>
      </Section>

      <Section icon={<Building2 className="h-5 w-5" />} title="Where your order is sourced from">
        <p>
          Our catalogue is sourced through accredited South African IT distribution partners — primarily{" "}
          <strong>Axiz</strong> (Alviva Holdings), with <strong>Pinnacle</strong> and <strong>Tarsus</strong> as
          additional approved distribution partners we draw on for stock availability and range. Regardless of
          which distributor a product is sourced from, every order you place with us ships and is tracked the
          same way — through The Courier Guy, with the tracking and account-page visibility described above.
        </p>
      </Section>

      <Section icon={<RotateCcw className="h-5 w-5" />} title="Returns & refunds">
        <p>
          <strong>Change of mind:</strong> you can return most items within <strong>30 days of delivery</strong> for
          a refund or exchange, provided they're unused, unopened, and in original packaging with all accessories.
          Return courier costs for change-of-mind returns are for the customer's account.
        </p>
        <p>
          <strong>Faulty or defective items:</strong> covered by the Consumer Protection Act's implied warranty of
          quality — if an item is defective, we'll repair, replace, or refund it at no cost to you, including
          return shipping, within 6 months of delivery.
        </p>
        <p>
          <strong>Not eligible for change-of-mind return:</strong> software licences and digital activation codes
          once redeemed, and custom or bespoke orders placed through our Business/Procurement portal.
        </p>
        <p>
          Approved refunds are issued to your original payment method within 7 business days of us receiving and
          inspecting the returned item.
        </p>
      </Section>

      <Section icon={<ClipboardList className="h-5 w-5" />} title="How to start a return">
        <p>
          Go to <Link to="/account" className="text-primary underline">My Account → Returns & Support</Link> and
          select "Start Return" on the relevant order. Our team will confirm collection or drop-off details by
          email within 1 business day.
        </p>
      </Section>

      <Section icon={<Mail className="h-5 w-5" />} title="Questions?">
        <p>
          Email <a className="text-primary underline" href="mailto:support@aismartstore.co.za">support@aismartstore.co.za</a>{" "}
          or use the chat assistant on any page. See also our{" "}
          <Link to="/compliance" className="text-primary underline">POPIA & PAIA compliance page</Link> for how we
          handle your personal information.
        </p>
      </Section>

      <p className="text-xs text-muted-foreground text-center mt-4 flex items-center justify-center gap-1.5">
        <Shield className="h-3.5 w-3.5" />
        Last updated: {new Date().toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" })}
      </p>
    </div>
  </div>
);

export default ShippingReturns;
