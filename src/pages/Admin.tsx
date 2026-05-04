import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Menu } from "lucide-react";
import AdminSidebar, { type AdminTab, tabs } from "@/components/admin/AdminSidebar";
import DashboardModule from "@/components/admin/DashboardModule";
import ProductsModule from "@/components/admin/ProductsModule";
import ImportModule from "@/components/admin/ImportModule";
import OrdersModule from "@/components/admin/OrdersModule";
import CustomersModule from "@/components/admin/CustomersModule";
import SupportModule from "@/components/admin/SupportModule";
import SettingsModule from "@/components/admin/SettingsModule";
import ReturnsModule from "@/components/admin/ReturnsModule";
import AILogsModule from "@/components/admin/AILogsModule";
import SyncLogsModule from "@/components/admin/SyncLogsModule";
import AutomationsModule from "@/components/admin/AutomationsModule";
import { useAdminData } from "@/hooks/useAdminData";

const Admin = () => {
  const [session, setSession] = useState<any>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();

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

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  if (checkingAuth || !session) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-muted">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground font-display font-medium">Loading Control Centre...</p>
        </div>
      </div>
    );
  }

  const currentTab = tabs.find((t) => t.id === activeTab);

  return (
    <div className="flex min-h-screen bg-muted/50">
      <AdminSidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        email={session?.user?.email || ""}
        onSignOut={handleSignOut}
      />

      <div className="flex-1 min-h-screen">
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
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center text-white text-xs font-display font-bold">
              {(session?.user?.email || "A").charAt(0).toUpperCase()}
            </div>
          </div>
        </div>

        <div className="p-4 lg:p-6">
          {activeTab === "dashboard" && (
            <DashboardModule products={products} orders={orders} customers={customers} onRefresh={reload.loadOrders} />
          )}
          {activeTab === "products" && (
            loading.products ? <LoadingSkeleton /> : <ProductsModule products={products} onReload={reload.loadProducts} />
          )}
          {activeTab === "import" && <ImportModule />}
          {activeTab === "orders" && (
            loading.orders ? <LoadingSkeleton /> : <OrdersModule orders={orders} onReload={reload.loadOrders} />
          )}
          {activeTab === "returns" && <ReturnsModule />}
          {activeTab === "customers" && (
            loading.customers ? <LoadingSkeleton /> : <CustomersModule customers={customers} orders={orders} />
          )}
          {activeTab === "support" && (
            loading.tickets ? <LoadingSkeleton /> : <SupportModule tickets={tickets} session={session} onReload={reload.loadTickets} />
          )}
          {activeTab === "ai-logs" && <AILogsModule />}
          {activeTab === "sync-logs" && <SyncLogsModule />}
          {activeTab === "automations" && <AutomationsModule />}
          {activeTab === "settings" && (
            <SettingsModule settings={settings} setSettings={setSettings} />
          )}
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
