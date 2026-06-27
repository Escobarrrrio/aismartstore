import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Globe2, RefreshCw } from "lucide-react";

interface Balance {
  currency: string;
  amount: number;
}

const TreasuryWidget = () => {
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: fnError } = await supabase.functions.invoke("wise-balances");
    setLoading(false);
    if (fnError || data?.error) {
      setError(data?.error || fnError?.message || "Couldn't load Wise balances");
      return;
    }
    setBalances(data.balances || []);
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return <div className="card-flat p-5 h-24 animate-pulse bg-muted/40" />;
  }

  if (error) {
    return (
      <div className="card-flat p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Globe2 className="h-4 w-4" /> Wise Treasury
        </div>
        <p className="text-xs text-muted-foreground mt-2">{error}</p>
      </div>
    );
  }

  return (
    <div className="card-flat p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-display font-bold">
          <Globe2 className="h-4 w-4 text-primary" /> Wise Treasury
        </div>
        <button onClick={load} className="text-muted-foreground hover:text-primary transition-colors">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      {balances && balances.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {balances.map((b) => (
            <div key={b.currency} className="bg-muted/40 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground font-medium">{b.currency}</p>
              <p className="font-display font-bold text-sm">{b.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No currency balances yet -- they'll show up here once funds land in your Wise account.</p>
      )}
    </div>
  );
};

export default TreasuryWidget;
