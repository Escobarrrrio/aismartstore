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
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground font-display">Loading...</p>
        </div>
      </div>
    );
  }

  const currentTab = tabs.find((t) => t.id === activeTab);

  return (
    <div className="flex min-h-screen">
      <AdminSidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        email={session?.user?.email || ""}
        onSignOut={handleSignOut}
      />

      <div className="flex-1 bg-muted min-h-screen">
        {/* Top bar */}
        <div className="sticky top-0 z-30 bg-card/80 backdrop-blur-md border-b border-border px-4 lg:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-1.5 rounded-md hover:bg-muted transition-colors">
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-primary">{currentTab?.icon}</span>
              <h1 className="font-display font-extrabold text-lg">{currentTab?.label}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-display font-bold">
              {(session?.user?.email || "A").charAt(0).toUpperCase()}
            </div>
          </div>
        </div>

        <div className="p-4 lg:p-6">
          {activeTab === "dashboard" && (
            <DashboardModule products={products} orders={orders} onRefresh={reload.loadOrders} />
          )}
          {activeTab === "products" && (
            loading.products ? <LoadingSkeleton /> : <ProductsModule products={products} onReload={reload.loadProducts} />
          )}
          {activeTab === "import" && <ImportModule />}
          {activeTab === "orders" && (
            loading.orders ? <LoadingSkeleton /> : <OrdersModule orders={orders} onReload={reload.loadOrders} />
          )}
          {activeTab === "customers" && (
            loading.customers ? <LoadingSkeleton /> : <CustomersModule customers={customers} orders={orders} />
          )}
          {activeTab === "support" && (
            loading.tickets ? <LoadingSkeleton /> : <SupportModule tickets={tickets} session={session} onReload={reload.loadTickets} />
          )}
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
    <div className="h-10 bg-card border border-border rounded-lg w-full max-w-md" />
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-border/50 last:border-none">
          <div className="w-9 h-9 rounded-md bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 bg-muted rounded w-1/3" />
            <div className="h-2.5 bg-muted rounded w-1/5" />
          </div>
          <div className="h-5 bg-muted rounded-full w-16" />
        </div>
      ))}
    </div>
  </div>
);

export default Admin;
