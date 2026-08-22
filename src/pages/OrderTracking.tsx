import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useLocale } from "@/contexts/LocaleContext";
import SEO from "@/components/SEO";
import {
  Package, CheckCircle2, Truck, Home, RotateCcw, ExternalLink,
  MapPin, ArrowLeft, ShieldCheck, Printer, Box,
} from "lucide-react";

const TRACK_PAGE = "https://portal.thecourierguy.co.za/track-parcel";

// Mirrors FULFILMENT_STEPS in the admin OrdersModule so the customer sees the
// same progression the shop actually moves an order through.
const STEPS = [
  { key: "pending", label: "Order placed", icon: Package },
  { key: "paid", label: "Payment confirmed", icon: CheckCircle2 },
  { key: "packed", label: "Packed", icon: Box },
  { key: "shipped", label: "Shipped", icon: Truck },
  { key: "delivered", label: "Delivered", icon: Home },
] as const;

type OrderRow = {
  id: string;
  created_at: string;
  total_amount: number;
  order_status: string;
  tracking_number: string | null;
  customer_name: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  province: string | null;
  order_items: {
    id: string;
    quantity: number;
    price: number;
    products: { name: string; images: string[] | null } | null;
  }[];
};

const OrderTracking = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { formatPrice } = useLocale();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, sess) => {
      setSession(sess);
      if (!sess) navigate(`/auth?redirect=/orders/${id}`);
    });
    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      setSession(sess);
      if (!sess) navigate(`/auth?redirect=/orders/${id}`);
    });
    return () => subscription.unsubscribe();
  }, [navigate, id]);

  useEffect(() => {
    if (!session || !id) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("orders")
        .select("id, created_at, total_amount, order_status, tracking_number, customer_name, address, city, postal_code, province, order_items(id, quantity, price, products(name, images))")
        .eq("id", id)
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (error || !data) {
        setNotFound(true);
      } else {
        setOrder(data as unknown as OrderRow);
      }
      setLoading(false);
    })();
  }, [session, id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !order) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Package className="h-12 w-12 text-muted-foreground/60 mx-auto mb-4" />
        <h1 className="font-display font-bold text-xl mb-2">Order not found</h1>
        <p className="text-sm text-muted-foreground mb-6">
          This order doesn't exist, or isn't associated with your account.
        </p>
        <Link to="/account" className="btn-primary px-6 py-2.5 text-sm inline-flex">Back to my orders</Link>
      </div>
    );
  }

  const isReturned = order.order_status === "returned";
  const currentStepIndex = STEPS.findIndex((s) => s.key === order.order_status);
  const trackUrl = order.tracking_number
    ? `${TRACK_PAGE}?ref=${encodeURIComponent(order.tracking_number)}`
    : null;

  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      <SEO title={`Order #${order.id.slice(0, 8).toUpperCase()}`} description="Track your AI Smart Store order." noindex />

      <div className="flex items-center justify-between mb-6 print:hidden">
        <Link to="/account" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to my orders
        </Link>
        <button onClick={() => window.print()} className="btn-secondary px-4 py-2 text-xs inline-flex items-center gap-1.5">
          <Printer className="h-3.5 w-3.5" /> Print / save as PDF
        </button>
      </div>

      <div className="flex items-start justify-between mb-8 flex-wrap gap-3">
        <div>
          <h1 className="font-display font-extrabold text-2xl tracking-tight">Order #{order.id.slice(0, 8).toUpperCase()}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Placed on {new Date(order.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <p className="font-display font-extrabold text-xl">{formatPrice(order.total_amount)}</p>
      </div>

      {isReturned ? (
        <div className="card-flat p-5 mb-8 flex items-center gap-3 border-amber-200 bg-amber-50">
          <RotateCcw className="h-6 w-6 text-amber-600 flex-shrink-0" />
          <div>
            <p className="font-display font-bold text-sm">This order was returned</p>
            <p className="text-xs text-muted-foreground">Contact support if you're waiting on a refund update.</p>
          </div>
        </div>
      ) : (
        <div className="card-flat p-6 mb-8">
          <div className="flex items-center justify-between">
            {STEPS.map((step, i) => {
              const done = i <= currentStepIndex;
              const isLast = i === STEPS.length - 1;
              return (
                <div key={step.key} className="flex items-center flex-1 last:flex-none">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                      done ? "bg-primary border-primary text-primary-foreground" : "border-border text-muted-foreground"
                    }`}>
                      <step.icon className="h-4 w-4" />
                    </div>
                    <p className={`text-[11px] font-semibold max-w-[5.5rem] ${done ? "text-foreground" : "text-muted-foreground"}`}>
                      {step.label}
                    </p>
                  </div>
                  {!isLast && (
                    <div className={`h-0.5 flex-1 mx-1.5 mb-5 transition-colors ${i < currentStepIndex ? "bg-primary" : "bg-border"}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {order.tracking_number && (
        <div className="card-flat p-5 mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Truck className="h-5 w-5 text-primary flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Courier Guy tracking number</p>
              <p className="font-display font-bold text-sm tracking-wide">{order.tracking_number}</p>
            </div>
          </div>
          {trackUrl && (
            <a
              href={trackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary px-4 py-2 text-xs inline-flex items-center gap-1.5 print:hidden"
            >
              Live scan events <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}

      {order.address && (
        <div className="card-flat p-5 mb-6 flex items-start gap-3">
          <MapPin className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-muted-foreground mb-1">Delivering to</p>
            <p className="text-sm font-medium">
              {order.address}, {order.city} {order.postal_code}{order.province ? `, ${order.province}` : ""}
            </p>
          </div>
        </div>
      )}

      <div className="card-flat overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-display font-bold text-sm">Items in this order</h2>
        </div>
        <div className="divide-y divide-border">
          {(order.order_items || []).map((item) => (
            <div key={item.id} className="p-4 flex items-center gap-3">
              <div className="h-12 w-12 rounded-lg bg-white border border-border/60 overflow-hidden flex-shrink-0">
                {item.products?.images?.[0] && (
                  <img src={item.products.images[0]} alt={item.products.name} className="h-full w-full object-contain p-1" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium line-clamp-1">{item.products?.name || "Product"}</p>
                <p className="text-xs text-muted-foreground">Qty {item.quantity}</p>
              </div>
              <p className="text-sm font-semibold">{formatPrice(item.price * item.quantity)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-emerald-600 flex-shrink-0" />
        <span>
          Order status here is authoritative on our side; scan-level delivery events (depot arrivals,
          out-for-delivery) come directly from The Courier Guy's own tracking system linked above.
        </span>
      </div>
    </div>
  );
};

export default OrderTracking;
