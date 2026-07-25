import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert, ArrowRight, Send, CheckCircle2 } from "lucide-react";
import { useCustomerType } from "@/hooks/useCustomerType";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { useToast } from "@/hooks/use-toast";

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
  const { toast } = useToast();
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [requestReason, setRequestReason] = useState("");

  // Residential shoppers can't flip their own customer_type (there's no
  // self-service path by design), but the old copy here was a dead end --
  // "contact support" with no actual way to do that from this screen. This
  // routes the request through the same support_tickets/ticket_messages
  // tables the rest of account support already uses, so it shows up in the
  // existing admin Support queue instead of requiring a new subsystem.
  const submitUpgradeRequest = async () => {
    if (!session?.user?.id) return;
    if (!companyName.trim()) {
      toast({ title: "Company / entity name required", description: "Tell us who you're procuring for.", variant: "destructive" });
      return;
    }
    setRequestLoading(true);
    const { data: ticket, error: ticketErr } = await supabase
      .from("support_tickets")
      .insert({
        user_id: session.user.id,
        subject: "Business / Government account upgrade request",
        status: "open",
        type: "inquiry",
      } as any)
      .select("id")
      .single();
    if (ticketErr || !ticket) {
      setRequestLoading(false);
      toast({ title: "Couldn't send request", description: ticketErr?.message ?? "Please try again.", variant: "destructive" });
      return;
    }
    const message = [
      `Requesting upgrade from Residential to Business / Government.`,
      `Company / entity: ${companyName.trim()}`,
      requestReason.trim() ? `Reason: ${requestReason.trim()}` : null,
    ].filter(Boolean).join("\n");
    const { error: msgErr } = await supabase.from("ticket_messages").insert({
      ticket_id: ticket.id,
      sender_id: session.user.id,
      message,
      is_admin: false,
    } as any);
    setRequestLoading(false);
    if (msgErr) {
      toast({ title: "Couldn't send request", description: msgErr.message, variant: "destructive" });
      return;
    }
    trackEvent({ name: "business_upgrade_requested" });
    setRequestSent(true);
  };

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
    // Only the residential-to-business direction gets a self-serve request
    // path here -- that's the actual case people hit (shopping around,
    // then realising they need the procurement portal). The reverse
    // direction is rare enough that "contact support" below still covers it.
    const canRequestUpgrade = allow === "business" && customerType === "residential";
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

          {canRequestUpgrade && requestSent ? (
            <div className="mb-6 flex items-center justify-center gap-2 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> Request sent — our team will review it and email you.
            </div>
          ) : canRequestUpgrade && requestOpen ? (
            <div className="mb-6 text-left space-y-3 bg-muted/40 border border-border rounded-xl p-5">
              <p className="text-xs font-semibold text-foreground">Apply for Business / Government access</p>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Registered company / entity name</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme (Pty) Ltd"
                  className="w-full px-3 py-2 rounded-lg border border-input bg-card text-sm outline-none focus:border-primary transition"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">What do you need the portal for? (optional)</label>
                <textarea
                  value={requestReason}
                  onChange={(e) => setRequestReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. Procuring laptops for our department"
                  className="w-full px-3 py-2 rounded-lg border border-input bg-card text-sm outline-none focus:border-primary transition resize-none"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={requestLoading}
                  onClick={submitUpgradeRequest}
                  className="btn-primary px-4 py-2 text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" /> {requestLoading ? "Sending…" : "Send request"}
                </button>
                <button type="button" onClick={() => setRequestOpen(false)} className="text-xs text-muted-foreground hover:underline">
                  Cancel
                </button>
              </div>
            </div>
          ) : canRequestUpgrade ? (
            <button
              type="button"
              onClick={() => setRequestOpen(true)}
              className="btn-primary px-6 py-3 text-sm inline-flex items-center gap-2 mb-4"
            >
              Apply for Business / Government access <ArrowRight className="h-4 w-4" />
            </button>
          ) : null}

          <div>
            <Link to={home} className={canRequestUpgrade ? "text-sm font-semibold text-primary hover:underline" : "btn-primary px-6 py-3 text-sm inline-flex items-center gap-2"}>
              {homeLabel} {!canRequestUpgrade && <ArrowRight className="h-4 w-4" />}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AudienceGuard;
