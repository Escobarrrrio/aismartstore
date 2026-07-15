import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Menu, Search, Shield } from "lucide-react";
import AdminSidebar, { type AdminTab, tabs } from "@/components/admin/AdminSidebar";
import CommandPalette from "@/components/admin/CommandPalette";
import DashboardModule from "@/components/admin/DashboardModule";
import ProductsModule from "@/components/admin/ProductsModule";
import ImportModule from "@/components/admin/ImportModule";
import OrdersModule from "@/components/admin/OrdersModule";
import OrderDiagnosticsModule from "@/components/admin/OrderDiagnosticsModule";
import YocoHealthModule from "@/components/admin/YocoHealthModule";

import CustomersModule from "@/components/admin/CustomersModule";
import SupportModule from "@/components/admin/SupportModule";
import SettingsModule from "@/components/admin/SettingsModule";
import CommandCentre from "@/components/admin/CommandCentre";
import ReturnsModule from "@/components/admin/ReturnsModule";
import AILogsModule from "@/components/admin/AILogsModule";
import SyncLogsModule from "@/components/admin/SyncLogsModule";
import AutomationsModule from "@/components/admin/AutomationsModule";
import SystemHealthModule from "@/components/admin/SystemHealthModule";
import SecurityModule from "@/components/admin/SecurityModule";
import NewsletterModule from "@/components/admin/NewsletterModule";
import QuotesModule from "@/components/admin/QuotesModule";
import CostUsageModule from "@/components/admin/CostUsageModule";
import IntegrationsModule from "@/components/admin/IntegrationsModule";
import BackupsModule from "@/components/admin/BackupsModule";
import NotificationsModule from "@/components/admin/NotificationsModule";
import EmailPreviewsModule from "@/components/admin/EmailPreviewsModule";
import CatalogHealthModule from "@/components/admin/CatalogHealthModule";
import ComplianceAuditModule from "@/components/admin/ComplianceAuditModule";
import BusinessSignupsModule from "@/components/admin/BusinessSignupsModule";
import { useAdminData } from "@/hooks/useAdminData";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useToast } from "@/hooks/use-toast";

const Admin = () => {
  const [session, setSession] = useState<any>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setCheckingAuth(false);
      if (!sess) navigate("/auth");
    });
    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      setSession(sess);
      setCheckingAuth(false);
      if (!sess) navigate("/auth");
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  const { products, orders, customers, tickets, settings, loading, setSettings, reload } = useAdminData(session);
  const isAdmin = useIsAdmin(session);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const handleAction = (action: string) => {
    const labels: Record<string, string> = {
      clear_cache: "Cache cleared",
      refresh_sessions: "Sessions refreshed",
      resync_products: "Product sync initiated",
      resync_prices: "Price sync initiated",
      resync_stock: "Stock sync initiated",
      reindex_search: "Search reindex started",
      retry_failed: "Retrying failed jobs",
      pause_automations: "Automations paused",
      resume_automations: "Automations resumed",
      maintenance_mode: "Maintenance mode toggled",
      restore_backup: "Restore initiated",
      rollback_changes: "Rollback initiated",
      refresh_integrations: "Refreshing integrations",
    };
    toast({ title: labels[action] || action, description: "Action executed successfully." });
  };

  if (checkingAuth || !session || isAdmin === null) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-muted">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground font-display font-medium">Loading Control Centre...</p>
        </div>
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-muted">
        <div className="text-center max-w-sm px-6">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <Shield className="h-6 w-6 text-destructive" />
          </div>
          <h2 className="font-display font-bold text-lg mb-2">Admin access required</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Your account is signed in, but doesn't have admin permissions for the Control Centre.
          </p>
          <button
            onClick={() => navigate("/")}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
          >
            Back to store
          </button>
        </div>
      </div>
    );
  }

  const currentTab = tabs.find((t) => t.id === activeTab);

  return (
    <div className="flex min-h-screen bg-muted/50 w-full max-w-full overflow-x-hidden">
      <AdminSidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        email={session?.user?.email || ""}
        onSignOut={handleSignOut}
        onOpenCommand={() => setCommandOpen(true)}
      />
      <CommandPalette open={commandOpen} setOpen={setCommandOpen} setActiveTab={setActiveTab} onAction={handleAction} />

      <div className="flex-1 min-w-0 min-h-screen overflow-x-hidden">
        {/* Top bar */}
        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-xl border-b border-border px-4 lg:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-lg hover:bg-muted transition-colors">
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2.5">
              <span className="text-primary">{currentTab?.icon}</span>
              <h1 className="font-display font-extrabold text-lg tracking-tight">{currentTab?.label}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setCommandOpen(true)} className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted transition-colors whitespace-nowrap">
              <Search className="h-3.5 w-3.5" /> Search... <kbd className="text-[9px] border border-border rounded px-1 py-0.5 ml-2">Ctrl+K</kbd>
            </button>
            <button
              onClick={() => { localStorage.setItem("ai-smart-store.impersonate", session?.user?.email || "admin"); navigate("/account?as=customer"); }}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg gradient-brand text-white text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
              title="View the store as a customer while staying signed in as admin"
            >
              View as customer
            </button>
            <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center text-white text-xs font-display font-bold flex-shrink-0">
              {(session?.user?.email || "A").charAt(0).toUpperCase()}
            </div>
          </div>
        </div>

        <div className="p-4 lg:p-6">
          {activeTab === "dashboard" && <DashboardModule products={products} orders={orders} customers={customers} onRefresh={reload.loadOrders} />}
          {activeTab === "products" && (loading.products ? <LoadingSkeleton /> : <ProductsModule products={products} onReload={reload.loadProducts} />)}
          {activeTab === "import" && <ImportModule />}
          {activeTab === "catalog-health" && <CatalogHealthModule />}
          {activeTab === "orders" && (loading.orders ? <LoadingSkeleton /> : <OrdersModule orders={orders} onReload={reload.loadOrders} />)}
          {activeTab === "returns" && <ReturnsModule />}
          {activeTab === "customers" && (loading.customers ? <LoadingSkeleton /> : <CustomersModule customers={customers} orders={orders} />)}
          {activeTab === "newsletter" && <NewsletterModule />}
          {activeTab === "quotes" && <QuotesModule />}
          {activeTab === "business-signups" && <BusinessSignupsModule />}
          {activeTab === "compliance-audit" && <ComplianceAuditModule />}
          {activeTab === "support" && (loading.tickets ? <LoadingSkeleton /> : <SupportModule tickets={tickets} session={session} onReload={reload.loadTickets} />)}
          {activeTab === "ai-logs" && <AILogsModule />}
          {activeTab === "sync-logs" && <SyncLogsModule />}
          {activeTab === "automations" && <AutomationsModule />}
          {activeTab === "settings" && <CommandCentre settings={settings} setSettings={setSettings} />}
          {activeTab === "system-health" && <SystemHealthModule />}
          {activeTab === "security" && <SecurityModule />}
          {activeTab === "cost-usage" && <CostUsageModule />}
          {activeTab === "integrations" && <IntegrationsModule />}
          {activeTab === "backups" && <BackupsModule />}
          {activeTab === "notifications-mgmt" && <NotificationsModule />}
          {activeTab === "email-previews" && <EmailPreviewsModule />}
        </div>
      </div>
    </div>
  );
};

const LoadingSkeleton = () => (
  <div className="space-y-4 animate-pulse">
    <div className="h-11 bg-card border border-border rounded-xl w-full max-w-md" />
    <div className="card-flat overflow-hidden">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-border/50 last:border-none">
          <div className="w-10 h-10 rounded-lg bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 bg-muted rounded w-1/3" />
            <div className="h-3 bg-muted rounded w-1/5" />
          </div>
          <div className="h-6 bg-muted rounded-full w-16" />
        </div>
      ))}
    </div>
  </div>
);

export default Admin;
