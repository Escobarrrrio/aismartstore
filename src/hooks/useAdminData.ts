import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface AdminData {
  session: any;
  products: any[];
  orders: any[];
  customers: any[];
  tickets: any[];
  settings: Record<string, string>;
  loading: {
    products: boolean;
    orders: boolean;
    customers: boolean;
    tickets: boolean;
  };
}

export function useAdminData(session: any) {
  const { toast } = useToast();
  const [products, setProducts] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState({
    products: true,
    orders: true,
    customers: true,
    tickets: true,
  });

  const loadProducts = useCallback(async () => {
    setLoading((p) => ({ ...p, products: true }));
    const { data } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    // Cost/margin columns are intentionally not selectable on the base
    // table for the 'authenticated' role (see security_lockdown migration
    // -- it's a column-level grant, applies regardless of admin status).
    // Admins fetch them through this RPC instead, which checks the admin
    // role server-side before returning anything.
    const { data: adminView } = await supabase.rpc("get_product_admin_view");
    const marginById = new Map((adminView || []).map((row: any) => [row.id, row]));

    const merged = (data || []).map((p: any) => ({
      ...p,
      ...(marginById.get(p.id) || {}),
    }));

    setProducts(merged);
    setLoading((p) => ({ ...p, products: false }));
  }, []);

  const loadOrders = useCallback(async () => {
    setLoading((p) => ({ ...p, orders: true }));
    const { data } = await supabase
      .from("orders")
      .select("*, order_items(*, products(name))")
      .order("created_at", { ascending: false });
    setOrders(data || []);
    setLoading((p) => ({ ...p, orders: false }));
  }, []);

  const loadCustomers = useCallback(async () => {
    setLoading((p) => ({ ...p, customers: true }));
    const { data } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
    setCustomers(data || []);
    setLoading((p) => ({ ...p, customers: false }));
  }, []);

  const loadTickets = useCallback(async () => {
    setLoading((p) => ({ ...p, tickets: true }));
    const { data } = await supabase
      .from("support_tickets")
      .select("*, ticket_messages(*)")
      .order("created_at", { ascending: false });
    setTickets(data || []);
    setLoading((p) => ({ ...p, tickets: false }));
  }, []);

  const loadSettings = useCallback(async () => {
    const { data } = await supabase.from("store_settings").select("*");
    if (data) {
      const map: Record<string, string> = {};
      data.forEach((s: any) => { map[s.key] = s.value; });
      setSettings(map);
    }
  }, []);

  useEffect(() => {
    if (session) {
      loadProducts();
      loadOrders();
      loadCustomers();
      loadTickets();
      loadSettings();
    }
  }, [session]);

  return {
    products, orders, customers, tickets, settings,
    loading,
    setSettings,
    reload: { loadProducts, loadOrders, loadCustomers, loadTickets, loadSettings },
    toast,
  };
}
