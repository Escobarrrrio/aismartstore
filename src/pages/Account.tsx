import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import {
  LayoutDashboard, ShoppingCart, RotateCcw, User, MapPin, Bell,
  Heart, Settings, LogOut, Menu, Package, Clock, ChevronRight,
  Mail, Phone, Shield, Download, MessageSquare, Truck, Star,
  Eye, CreditCard, FileText, ArrowRight, Bot, Search, X, ShieldCheck
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { useLocale } from "@/contexts/LocaleContext";
import { formatMoney } from "@/lib/currency";
import { useCart } from "@/contexts/CartContext";

type AccountTab = "overview" | "orders" | "returns" | "profile" | "addresses" | "notifications" | "wishlist" | "settings";

const accountTabs: { id: AccountTab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: "orders", label: "Orders", icon: <ShoppingCart className="h-4 w-4" /> },
  { id: "returns", label: "Returns & Support", icon: <RotateCcw className="h-4 w-4" /> },
  { id: "profile", label: "Profile", icon: <User className="h-4 w-4" /> },
  { id: "addresses", label: "Addresses", icon: <MapPin className="h-4 w-4" /> },
  { id: "notifications", label: "Notifications", icon: <Bell className="h-4 w-4" /> },
  { id: "wishlist", label: "Saved Items", icon: <Heart className="h-4 w-4" /> },
  { id: "settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
];

const Account = () => {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AccountTab>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { currency } = useLocale();
  const { addToCart } = useCart();
  const [searchParams] = useSearchParams();
  const isImpersonating = searchParams.get("as") === "customer" && !!localStorage.getItem("ai-smart-store.impersonate");

  const exitImpersonation = () => {
    localStorage.removeItem("ai-smart-store.impersonate");
    navigate("/admin");
  };

  const requestReturn = async (orderId: string) => {
    if (!session) return;
    const { error } = await supabase.from("returns").insert({
      user_id: session.user.id,
      order_id: orderId,
      status: "open",
      reason: "Customer-initiated return request",
    } as any);
    if (error) {
      toast({ title: "Could not start return", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Return request submitted", description: "Our team will be in touch shortly." });
    }
  };

  const createTicket = async (subject: string, body: string) => {
    if (!session) return;
    const { error } = await supabase.from("support_tickets").insert({
      user_id: session.user.id,
      subject,
      status: "open",
      type: "inquiry",
    } as any);
    if (error) {
      toast({ title: "Could not open ticket", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Support ticket opened", description: "You'll receive a reply by email." });
    }
  };

  const reorder = async (order: any) => {
    const items = order.order_items || [];
    if (!items.length) {
      toast({ title: "Nothing to reorder", description: "This order has no items." });
      return;
    }
    for (const it of items) {
      if (it.products) {
        addToCart({
          id: it.product_id,
          name: it.products.name,
          description: "",
          price: Number(it.price ?? 0),
          category: "",
          images: it.products.images || [],
          inStock: true,
          createdAt: new Date().toISOString(),
        } as any, it.quantity || 1);
      }
    }
    toast({ title: "Items added to cart", description: `${items.length} item(s) restored from the order.` });
    navigate("/cart");
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, sess) => {
      setSession(sess);
      setLoading(false);
      if (!sess) navigate("/auth");
    });
    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      setSession(sess);
      setLoading(false);
      if (!sess) navigate("/auth");
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (!session) return;
    const loadData = async () => {
      const { data: profileData } = await supabase.from("profiles").select("*").eq("user_id", session.user.id).maybeSingle();
      setProfile(profileData);
      const { data: orderData } = await supabase.from("orders").select("*, order_items(*, products(name, images))").eq("user_id", session.user.id).order("created_at", { ascending: false });
      setOrders(orderData || []);
    };
    loadData();
  }, [session]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  if (loading || !session) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const userName = profile?.name || session.user?.email?.split("@")[0] || "Customer";
  const userEmail = session.user?.email || "";

  const statusColor = (s: string) => {
    if (["delivered", "paid"].includes(s)) return "badge-success";
    if (["shipped", "processing"].includes(s)) return "badge-info";
    if (["pending"].includes(s)) return "badge-warning";
    return "badge-neutral";
  };

  return (
    <div className="min-h-screen bg-muted/30 w-full max-w-full overflow-x-hidden">
      {isImpersonating && (
        <div className="w-full bg-gradient-to-r from-primary/10 via-secondary/10 to-primary/10 border-b border-primary/20">
          <div className="container mx-auto px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs sm:text-sm">
              <ShieldCheck className="h-4 w-4 text-primary flex-shrink-0" />
              <span className="font-semibold">{t("account.viewingAsCustomer")}</span>
              <span className="text-muted-foreground hidden sm:inline">— admin tools paused for this view</span>
            </div>
            <button onClick={exitImpersonation} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-foreground text-background hover:opacity-90 transition-opacity whitespace-nowrap">
              {t("account.returnToAdmin")}
            </button>
          </div>
        </div>
      )}
      <div className="container mx-auto px-4 py-6 lg:py-10 max-w-full">
        <div className="flex gap-6 min-w-0">
          {/* Sidebar */}
          {sidebarOpen && <div className="fixed inset-0 bg-foreground/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}
          <aside className={`fixed top-0 left-0 bottom-0 w-[260px] bg-card border-r border-border z-50 flex flex-col lg:sticky lg:top-20 lg:h-fit lg:rounded-2xl lg:border lg:w-[240px] lg:shrink-0 transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:relative`}>
            <div className="p-5 border-b border-border lg:rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl gradient-brand flex items-center justify-center text-white font-display font-bold text-lg">
                  {userName[0]?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-display font-bold text-sm truncate">{userName}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{userEmail}</p>
                </div>
              </div>
            </div>
            <nav className="flex-1 py-2 overflow-y-auto">
              {accountTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setSidebarOpen(false); }}
                  className={`w-full flex items-center gap-3 px-5 py-3 text-sm font-medium transition-all ${
                    activeTab === tab.id
                      ? "text-primary bg-primary/[0.06] border-l-2 border-l-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted border-l-2 border-l-transparent"
                  }`}
                >
                  <span className={activeTab === tab.id ? "text-primary" : "text-muted-foreground/50"}>{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </nav>
            <div className="p-4 border-t border-border">
              <button onClick={handleSignOut} className="flex items-center gap-2 text-muted-foreground text-sm hover:text-foreground transition-colors">
                <LogOut className="h-4 w-4" /> Sign Out
              </button>
            </div>
          </aside>

          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {/* Mobile header */}
            <div className="flex items-center gap-3 mb-6 lg:hidden">
              <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-xl border border-border hover:bg-muted transition-colors">
                <Menu className="h-5 w-5" />
              </button>
              <h1 className="font-display font-extrabold text-lg">{accountTabs.find(t => t.id === activeTab)?.label}</h1>
            </div>

            {/* Overview */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                <div className="card-flat p-6 lg:p-8">
                  <h1 className="font-display font-extrabold text-2xl mb-1">Welcome back, {userName}</h1>
                  <p className="text-sm text-muted-foreground">Manage your orders, returns, and account settings all in one place.</p>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="card-flat p-4 text-center">
                    <Package className="h-5 w-5 mx-auto mb-2 text-primary" />
                    <p className="font-display font-extrabold text-2xl">{orders.length}</p>
                    <p className="text-[11px] text-muted-foreground font-medium">Total Orders</p>
                  </div>
                  <div className="card-flat p-4 text-center">
                    <Truck className="h-5 w-5 mx-auto mb-2 text-amber-500" />
                    <p className="font-display font-extrabold text-2xl">{orders.filter(o => o.status === "shipped").length}</p>
                    <p className="text-[11px] text-muted-foreground font-medium">In Transit</p>
                  </div>
                  <div className="card-flat p-4 text-center">
                    <RotateCcw className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
                    <p className="font-display font-extrabold text-2xl">0</p>
                    <p className="text-[11px] text-muted-foreground font-medium">Returns</p>
                  </div>
                  <div className="card-flat p-4 text-center">
                    <Heart className="h-5 w-5 mx-auto mb-2 text-red-400" />
                    <p className="font-display font-extrabold text-2xl">0</p>
                    <p className="text-[11px] text-muted-foreground font-medium">Wishlist</p>
                  </div>
                </div>
                {orders.length > 0 && (
                  <div className="card-flat overflow-hidden">
                    <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                      <h3 className="font-display font-bold text-sm">Recent Orders</h3>
                      <button onClick={() => setActiveTab("orders")} className="text-xs text-primary font-semibold flex items-center gap-1">View all <ChevronRight className="h-3 w-3" /></button>
                    </div>
                    <div className="divide-y divide-border/50">
                      {orders.slice(0, 3).map((order) => (
                        <div key={order.id} className="flex items-center justify-between px-5 py-4">
                          <div>
                            <p className="text-sm font-semibold">{order.id.slice(0, 8).toUpperCase()}</p>
                            <p className="text-[11px] text-muted-foreground">{new Date(order.created_at).toLocaleDateString()}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold">{formatMoney(order.total_amount, currency)}</p>
                            <span className={`${statusColor(order.status)} text-[10px]`}>{order.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Trust messaging */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="card-flat p-4 flex items-start gap-3">
                    <Shield className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold">Secure Account</p>
                      <p className="text-[11px] text-muted-foreground">Your data is protected with enterprise-grade security</p>
                    </div>
                  </div>
                  <div className="card-flat p-4 flex items-start gap-3">
                    <CreditCard className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold">Safe Payments</p>
                      <p className="text-[11px] text-muted-foreground">Card details never stored on our servers</p>
                    </div>
                  </div>
                  <div className="card-flat p-4 flex items-start gap-3">
                    <Bot className="h-5 w-5 text-secondary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold">AI Support</p>
                      <p className="text-[11px] text-muted-foreground">Get instant help from our AI assistant anytime</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Orders */}
            {activeTab === "orders" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display font-extrabold text-xl">Order History</h2>
                </div>
                {orders.length === 0 ? (
                  <div className="card-flat p-12 text-center">
                    <Package className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                    <p className="font-display font-bold text-lg mb-1">No orders yet</p>
                    <p className="text-sm text-muted-foreground mb-4">Start shopping to see your orders here</p>
                    <Link to="/products" className="btn-primary px-6 py-2.5 text-sm">Browse Products</Link>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {orders.map((order) => (
                      <div key={order.id} className="card-flat p-5">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <p className="font-display font-bold text-sm">Order #{order.id.slice(0, 8).toUpperCase()}</p>
                            <p className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-display font-bold">{formatMoney(order.total_amount, currency)}</p>
                            <span className={`${statusColor(order.status)} text-[10px]`}>{order.status}</span>
                          </div>
                        </div>
                        {order.tracking_number && (
                          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-primary/[0.04] mb-3">
                            <Truck className="h-4 w-4 text-primary" />
                            <span className="text-xs font-medium">Tracking: {order.tracking_number}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                          <button onClick={() => toast({ title: `Order #${order.id.slice(0, 8).toUpperCase()}`, description: `${order.order_items?.length || 0} item(s), total ${formatMoney(order.total_amount, currency)}.` })} className="btn-secondary px-3 py-1.5 text-xs rounded-lg"><Eye className="h-3 w-3" /> Details</button>
                          <button onClick={() => toast({ title: "Invoice", description: "Your invoice will be emailed shortly." })} className="btn-ghost px-3 py-1.5 text-xs rounded-lg"><FileText className="h-3 w-3" /> Invoice</button>
                          <button onClick={() => reorder(order)} className="btn-ghost px-3 py-1.5 text-xs rounded-lg"><ShoppingCart className="h-3 w-3" /> Reorder</button>
                          <button onClick={() => requestReturn(order.id)} className="btn-ghost px-3 py-1.5 text-xs rounded-lg"><RotateCcw className="h-3 w-3" /> Request return</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Returns & Support */}
            {activeTab === "returns" && (
              <div className="space-y-4">
                <h2 className="font-display font-extrabold text-xl">Returns & Support</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="card-flat p-6 text-center">
                    <RotateCcw className="h-8 w-8 mx-auto mb-3 text-primary" />
                    <h3 className="font-display font-bold mb-1">Request a Return</h3>
                    <p className="text-xs text-muted-foreground mb-4">Start a return for any eligible order</p>
                    <button onClick={() => orders[0] ? requestReturn(orders[0].id) : toast({ title: "No eligible orders", description: "You need at least one paid order to request a return." })} className="btn-primary px-5 py-2.5 text-sm">Start Return</button>
                  </div>
                  <div className="card-flat p-6 text-center">
                    <MessageSquare className="h-8 w-8 mx-auto mb-3 text-secondary" />
                    <h3 className="font-display font-bold mb-1">Contact Support</h3>
                    <p className="text-xs text-muted-foreground mb-4">Get help from our team or AI assistant</p>
                    <button onClick={() => createTicket("General inquiry", "Customer opened a support ticket from the portal.")} className="btn-primary px-5 py-2.5 text-sm">Open Ticket</button>
                  </div>
                </div>
              </div>
            )}

            {/* Profile */}
            {activeTab === "profile" && (
              <div className="space-y-4 max-w-lg">
                <h2 className="font-display font-extrabold text-xl">Personal Profile</h2>
                <div className="card-flat p-6 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold mb-1.5">Full Name</label>
                    <input type="text" defaultValue={profile?.name || ""} className="input-premium" placeholder="Your name" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5">Email</label>
                    <input type="email" value={userEmail} disabled className="input-premium opacity-60" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5">Phone</label>
                    <input type="tel" defaultValue={profile?.phone || ""} className="input-premium" placeholder="+27..." />
                  </div>
                  <button className="btn-primary px-5 py-2.5 text-sm w-full">Save Profile</button>
                </div>
                <div className="card-flat p-6 space-y-4">
                  <h3 className="font-display font-bold text-sm">Change Password</h3>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5">New Password</label>
                    <input type="password" className="input-premium" placeholder="Enter new password" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5">Confirm Password</label>
                    <input type="password" className="input-premium" placeholder="Confirm new password" />
                  </div>
                  <button className="btn-secondary px-5 py-2.5 text-sm w-full">Update Password</button>
                </div>
              </div>
            )}

            {/* Addresses */}
            {activeTab === "addresses" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display font-extrabold text-xl">Address Book</h2>
                  <button className="btn-primary px-4 py-2 text-sm">Add Address</button>
                </div>
                <div className="card-flat p-12 text-center">
                  <MapPin className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                  <p className="font-display font-bold text-lg mb-1">No saved addresses</p>
                  <p className="text-sm text-muted-foreground">Add a shipping or billing address for faster checkout</p>
                </div>
              </div>
            )}

            {/* Notifications */}
            {activeTab === "notifications" && (
              <div className="space-y-4 max-w-lg">
                <h2 className="font-display font-extrabold text-xl">Notification Preferences</h2>
                <div className="card-flat p-6 space-y-4">
                  {[
                    { label: "Order updates", desc: "Get notified about order status changes", default: true },
                    { label: "Delivery alerts", desc: "Tracking and delivery notifications", default: true },
                    { label: "Promotional emails", desc: "Deals, new products, and offers", default: false },
                    { label: "SMS notifications", desc: "Receive updates via SMS", default: false },
                  ].map((pref, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-border">
                      <div>
                        <p className="text-sm font-semibold">{pref.label}</p>
                        <p className="text-[10px] text-muted-foreground">{pref.desc}</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" defaultChecked={pref.default} className="sr-only peer" />
                        <div className="w-9 h-5 bg-muted rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Wishlist */}
            {activeTab === "wishlist" && (
              <div className="space-y-4">
                <h2 className="font-display font-extrabold text-xl">Saved Items</h2>
                <div className="card-flat p-12 text-center">
                  <Heart className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                  <p className="font-display font-bold text-lg mb-1">Your wishlist is empty</p>
                  <p className="text-sm text-muted-foreground mb-4">Save items you love for later</p>
                  <Link to="/products" className="btn-primary px-6 py-2.5 text-sm">Explore Products</Link>
                </div>
              </div>
            )}

            {/* Settings */}
            {activeTab === "settings" && (
              <div className="space-y-4 max-w-lg">
                <h2 className="font-display font-extrabold text-xl">Account Settings</h2>
                <div className="space-y-3">
                  {[
                    { label: "Privacy controls", desc: "Manage how your data is used", icon: <Shield className="h-4 w-4" /> },
                    { label: "Data export", desc: "Download a copy of your data", icon: <Download className="h-4 w-4" /> },
                    { label: "Account deletion", desc: "Permanently delete your account", icon: <X className="h-4 w-4" />, danger: true },
                  ].map((item, i) => (
                    <button key={i} className={`w-full card-flat p-4 flex items-center gap-4 text-left hover:shadow-md transition-all ${item.danger ? "hover:border-destructive/30" : ""}`}>
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${item.danger ? "bg-destructive/10 text-destructive" : "bg-primary/[0.06] text-primary"}`}>{item.icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold ${item.danger ? "text-destructive" : ""}`}>{item.label}</p>
                        <p className="text-[10px] text-muted-foreground">{item.desc}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Account;
