import { useEffect, useRef, useState, Component, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Cpu, Sparkles, Zap, ShieldCheck } from "lucide-react";

/**
 * AiNexusStage
 * -------------
 * Living, generative hero visualization for the AI Smart Store home page.
 *
 * Design goals:
 *   1. Feel ALIVE — a real neural-mesh that reacts to cursor + time.
 *   2. Be unbreakable — no external deps, offscreen-safe, DPR-aware,
 *      auto-pauses when tab is hidden, respects prefers-reduced-motion,
 *      wrapped in an ErrorBoundary with a graceful static fallback.
 *   3. Feel premium — brand gradient (cyan → violet → magenta) matches
 *      the site's shimmer text, on a clean white surface.
 *
 * No <canvas> access is ever assumed — every ctx call is guarded, and
 * the animation loop cancels itself on error rather than crashing React.
 */

type Node = {
  x: number; y: number;         // current position
  vx: number; vy: number;       // velocity
  r: number;                    // radius
  hue: number;                  // 190 (cyan) → 320 (magenta)
  pulse: number;                // 0..1 pulse phase
  pulseSpeed: number;
};

class NexusBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: unknown) {
    // Keep the app alive; log for diagnostics only.
    // eslint-disable-next-line no-console
    console.warn("[AiNexusStage] boundary caught:", err);
  }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

const StaticFallback = () => (
  <div className="relative aspect-[5/4] w-full rounded-3xl overflow-hidden bg-gradient-to-br from-[hsl(190,90%,55%)]/10 via-[hsl(260,85%,60%)]/10 to-[hsl(320,85%,60%)]/10 border border-border/60 flex items-center justify-center">
    <div className="text-center px-6">
      <Sparkles className="h-10 w-10 mx-auto mb-3 text-primary" />
      <p className="font-display font-bold text-lg">AI Smart Store</p>
      <p className="text-sm text-muted-foreground">South Africa's living AI marketplace</p>
    </div>
  </div>
);

const NexusCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const mouseRef = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });
  const sizeRef = useRef<{ w: number; h: number; dpr: number }>({ w: 0, h: 0, dpr: 1 });
  const [reduced, setReduced] = useState(false);
  const [live, setLive] = useState({ skus: 94111, ai: 209, latency: 42 });

  // Reduced-motion preference
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  // Micro live-counter (purely cosmetic; never crashes)
  useEffect(() => {
    const id = window.setInterval(() => {
      setLive((s) => ({
        skus: s.skus + Math.floor(Math.random() * 3),
        ai: s.ai + (Math.random() > 0.7 ? 1 : 0),
        latency: 32 + Math.floor(Math.random() * 24),
      }));
    }, 2400);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = canvas.getContext("2d"); } catch { ctx = null; }
    if (!ctx) return; // Boundary fallback would replace us via the outer StaticFallback.

    const seedNodes = (w: number, h: number) => {
      const count = Math.max(22, Math.min(46, Math.floor((w * h) / 22000)));
      const nodes: Node[] = [];
      for (let i = 0; i < count; i++) {
        nodes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.35,
          r: 1.5 + Math.random() * 2.2,
          hue: 190 + Math.random() * 130,     // cyan → magenta band
          pulse: Math.random(),
          pulseSpeed: 0.005 + Math.random() * 0.012,
        });
      }
      nodesRef.current = nodes;
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      sizeRef.current = { w, h, dpr };
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (nodesRef.current.length === 0) seedNodes(w, h);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, active: true };
    };
    const onLeave = () => { mouseRef.current.active = false; };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    let running = true;
    const onVis = () => {
      if (document.hidden) {
        running = false;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      } else if (!running) {
        running = true;
        loop();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    const LINK_DIST = 130;
    const draw = () => {
      const { w, h } = sizeRef.current;
      const nodes = nodesRef.current;
      if (!ctx || !nodes.length) return;

      // Clear with subtle wash (pure white base; the parent card is white)
      ctx.clearRect(0, 0, w, h);

      // Backdrop soft gradient blooms
      const g1 = ctx.createRadialGradient(w * 0.2, h * 0.25, 10, w * 0.2, h * 0.25, w * 0.6);
      g1.addColorStop(0, "hsla(190, 95%, 60%, 0.10)");
      g1.addColorStop(1, "hsla(190, 95%, 60%, 0)");
      ctx.fillStyle = g1; ctx.fillRect(0, 0, w, h);

      const g2 = ctx.createRadialGradient(w * 0.85, h * 0.8, 10, w * 0.85, h * 0.8, w * 0.6);
      g2.addColorStop(0, "hsla(320, 90%, 62%, 0.10)");
      g2.addColorStop(1, "hsla(320, 90%, 62%, 0)");
      ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h);

      // Update + draw links
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
        n.x = Math.max(0, Math.min(w, n.x));
        n.y = Math.max(0, Math.min(h, n.y));
        n.pulse = (n.pulse + n.pulseSpeed) % 1;

        // Cursor attraction
        if (mouseRef.current.active) {
          const dx = mouseRef.current.x - n.x;
          const dy = mouseRef.current.y - n.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 180 * 180) {
            const f = 0.0006;
            n.vx += dx * f;
            n.vy += dy * f;
          }
        }
        // Velocity damping to stay calm
        n.vx *= 0.985; n.vy *= 0.985;
        // Minimum drift so it never stalls
        if (Math.abs(n.vx) < 0.05) n.vx += (Math.random() - 0.5) * 0.06;
        if (Math.abs(n.vy) < 0.05) n.vy += (Math.random() - 0.5) * 0.06;
      }

      // Links
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < LINK_DIST) {
            const t = 1 - d / LINK_DIST;
            const hue = (a.hue + b.hue) / 2;
            ctx.strokeStyle = `hsla(${hue}, 90%, 60%, ${0.18 * t})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Nodes with pulse glow
      for (const n of nodes) {
        const glow = 0.6 + 0.4 * Math.sin(n.pulse * Math.PI * 2);
        const rr = n.r * (1 + 0.25 * glow);
        const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, rr * 6);
        grad.addColorStop(0, `hsla(${n.hue}, 95%, 65%, ${0.55 * glow})`);
        grad.addColorStop(1, `hsla(${n.hue}, 95%, 65%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(n.x, n.y, rr * 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `hsl(${n.hue}, 90%, 55%)`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const loop = () => {
      try { draw(); } catch (e) {
        // Never crash the app because of the animation
        // eslint-disable-next-line no-console
        console.warn("[AiNexusStage] draw error, stopping:", e);
        running = false;
        return;
      }
      if (running && !reduced) rafRef.current = requestAnimationFrame(loop);
    };

    if (reduced) {
      // Draw one static frame only
      try { draw(); } catch { /* ignore */ }
    } else {
      loop();
    }

    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced]);

  return (
    <div ref={wrapRef} className="relative aspect-[5/4] w-full rounded-3xl overflow-hidden bg-white border border-border/60 shadow-[0_30px_80px_-40px_hsl(260_85%_60%/0.35)]">
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />

      {/* Foreground UI layer */}
      <div className="absolute inset-0 flex flex-col justify-between p-5 md:p-6 pointer-events-none">
        {/* Top status pill */}
        <div className="flex items-center justify-between">
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-white/85 backdrop-blur px-3 py-1.5 border border-border/60 shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-[11px] font-semibold text-foreground">Neural mesh · live</span>
          </div>
          <div className="pointer-events-auto rounded-full bg-white/85 backdrop-blur px-3 py-1.5 border border-border/60 shadow-sm text-[11px] font-mono text-muted-foreground">
            {live.latency}ms
          </div>
        </div>

        {/* Center brand medallion */}
        <div className="flex items-center justify-center">
          <div className="pointer-events-auto flex flex-col items-center">
            <div className="relative">
              <div className="absolute inset-0 -m-3 rounded-full bg-gradient-to-br from-[hsl(190,95%,60%)] via-[hsl(260,85%,60%)] to-[hsl(320,85%,60%)] blur-2xl opacity-40 animate-pulse" />
              <div className="relative h-20 w-20 md:h-24 md:w-24 rounded-full bg-gradient-to-br from-[hsl(190,95%,60%)] via-[hsl(260,85%,60%)] to-[hsl(320,85%,60%)] flex items-center justify-center shadow-lg">
                <Cpu className="h-9 w-9 md:h-11 md:w-11 text-white drop-shadow" />
              </div>
            </div>
            <p className="mt-3 font-display font-extrabold text-base md:text-lg tracking-tight text-foreground">
              AI Nexus
            </p>
            <p className="text-[11px] text-muted-foreground">South Africa's living catalogue</p>
          </div>
        </div>

        {/* Bottom stat strip */}
        <div className="pointer-events-auto grid grid-cols-3 gap-2">
          <StatChip icon={<Sparkles className="h-3 w-3" />} label="Live SKUs" value={live.skus.toLocaleString("en-ZA")} />
          <StatChip icon={<Zap className="h-3 w-3" />} label="AI-ready" value={live.ai.toLocaleString("en-ZA")} />
          <StatChip icon={<ShieldCheck className="h-3 w-3" />} label="Uptime" value="99.98%" />
        </div>
      </div>

      {/* Corner CTA overlay (clickable) */}
      <Link
        to="/products"
        className="absolute right-4 bottom-20 md:bottom-24 pointer-events-auto text-[11px] font-semibold text-primary bg-white/90 backdrop-blur border border-border/60 rounded-full px-3 py-1.5 shadow-sm hover:shadow-md transition-shadow"
      >
        Explore catalogue →
      </Link>
    </div>
  );
};

const StatChip = ({ icon, label, value }: { icon: ReactNode; label: string; value: string }) => (
  <div className="rounded-xl bg-white/85 backdrop-blur border border-border/60 px-3 py-2 shadow-sm">
    <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {icon} {label}
    </div>
    <p className="font-display font-bold text-sm text-foreground mt-0.5 tabular-nums">{value}</p>
  </div>
);

const AiNexusStage = () => (
  <NexusBoundary fallback={<StaticFallback />}>
    <NexusCanvas />
  </NexusBoundary>
);

export default AiNexusStage;
