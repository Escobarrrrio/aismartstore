import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert, ArrowRight } from "lucide-react";
import { useCustomerType } from "@/hooks/useCustomerType";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";

type Audience = "residential" | "business";

interface Props {
  /** Which audience is permitted to see the wrapped page. */
  allow: Audience;
  children: ReactNode;
}

/**
 * Client-side audience guard.
 *
 * Residential shoppers hitting /procurement (or any business-only page) are
 * shown a clear message and a link back to the residential storefront —
 * even when they type the URL directly. Anonymous visitors and admins
 * always pass through (admins may impersonate either audience; anonymous
 * visitors haven't declared a type yet).
 *
 * NOTE: This is a UX/product-relevance guard, not an authorization boundary.
 * Sensitive procurement data (compliance pack, quote-request PII, cost
 * pricing) is enforced by RLS/security-definer RPCs on the database side —
 * see `get_compliance_pack`, `get_product_admin_view`, and the row policies
 * on `quote_requests` / `compliance_documents`.
 */
const AudienceGuard = ({ allow, children }: Props) => {
  const [session, setSession] = useState<any>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const isAdmin = useIsAdmin(session);
  const customerType = useCustomerType();

  // Wait for both checks to resolve before deciding.
  const stillChecking = customerType === undefined || (session && isAdmin === null);
  const blocked =
    !stillChecking &&
    !isAdmin &&
    customerType !== null && // anonymous visitors pass through
    customerType !== allow;

  useEffect(() => {
    if (blocked) {
      trackEvent({
        name: "audience_guard_blocked",
        allow,
        actual: customerType ?? "anonymous",
      });
    }
  }, [blocked, allow, customerType]);

  if (stillChecking) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-pulse text-sm text-muted-foreground">Verifying access…</div>
      </div>
    );
  }

  if (blocked) {
    const target = allow === "business" ? "Business / Government portal" : "Residential storefront";
    const home = allow === "business" ? "/" : "/procurement";
    const homeLabel = allow === "business" ? "Go to the residential store" : "Go to the Business Portal";
    return (
      <div className="container mx-auto px-4 py-20">
        <div className="max-w-xl mx-auto text-center card-flat p-10">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-5">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <h1 className="font-display font-extrabold text-2xl mb-2">
            This section isn't available on your account
          </h1>
          <p className="text-muted-foreground text-sm mb-6">
            The <strong>{target}</strong> is reserved for {allow === "business"
              ? "verified business, government and institutional buyers"
              : "residential shoppers"}. Your account is registered as{" "}
            <span className="font-semibold text-foreground capitalize">{customerType}</span>.
            Account type can't be changed self-service — please contact support if you
            believe this is incorrect.
          </p>
          <Link to={home} className="btn-primary px-6 py-3 text-sm inline-flex items-center gap-2">
            {homeLabel} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AudienceGuard;
