import { useEffect, useRef, useState, Component, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Zap, ShieldCheck, RefreshCw, Brain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * AiNexusStage
 * -------------
 * Living, generative hero visualization for the AI Smart Store home page —
 * the main-attraction centerpiece: a neural core actively "thinking."
 *
 * Design goals:
 *   1. Feel ALIVE — a real neural-mesh that reacts to cursor + time, with
 *      data visibly flowing between hub nodes like an active AI system.
 *   2. Be unbreakable — no external deps, offscreen-safe, DPR-aware,
 *      auto-pauses when tab is hidden, respects prefers-reduced-motion,
 *      wrapped in an ErrorBoundary with a graceful static fallback.
 *   3. Feel premium and unmistakably "AI at its peak" — brand gradient
 *      (cyan → violet → magenta), a reactor-style rotating core, orbiting
 *      capability glyphs, and a slow radar sweep across the mesh.
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
  hub: boolean;                 // hub nodes render bigger/brighter, anchor the mesh
};

type Packet = {
  from: number; to: number;     // node indices
  t: number;                    // 0..1 progress along the link
  speed: number;
  hue: number;
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

const HUB_RATIO = 0.16; // ~1 in 6 nodes is a bright "core" hub

const NexusCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const packetsRef = useRef<Packet[]>([]);
  const mouseRef = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });
  const sizeRef = useRef<{ w: number; h: number; dpr: number }>({ w: 0, h: 0, dpr: 1 });
  const [reduced, setReduced] = useState(false);
  // Real counts fetched from the catalogue -- these used to be a fabricated
  // starting number (94,111) that faked its own growth every few seconds.
  // A store showing invented "live" stats is exactly the kind of thing that
  // reads as untrustworthy once anyone checks, so this now reflects what's
  // actually in the database, refreshed periodically rather than randomly
  // incremented.
  const [live, setLive] = useState<{ skus: number | null; ai: number | null }>({ skus: null, ai: null });

  // Reduced-motion preference
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchCounts = async () => {
      const [{ count: skus }, { count: ai }] = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("is_active", true).eq("is_ai_product", true),
      ]);
      if (!cancelled) setLive({ skus: skus ?? null, ai: ai ?? null });
    };
    fetchCounts();
    const id = window.setInterval(fetchCounts, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = canvas.getContext("2d"); } catch { ctx = null; }
    if (!ctx) return; // Boundary fallback would replace us via the outer StaticFallback.

    const seedNodes = (w: number, h: number) => {
      const count = Math.max(28, Math.min(60, Math.floor((w * h) / 17000)));
      const nodes: Node[] = [];
      for (let i = 0; i < count; i++) {
        const hub = Math.random() < HUB_RATIO;
        nodes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * (hub ? 0.18 : 0.35),
          vy: (Math.random() - 0.5) * (hub ? 0.18 : 0.35),
          r: hub ? 3.4 + Math.random() * 1.8 : 1.4 + Math.random() * 1.8,
          hue: 190 + Math.random() * 130,     // cyan → magenta band
          pulse: Math.random(),
          pulseSpeed: (hub ? 0.008 : 0.005) + Math.random() * 0.012,
          hub,
        });
      }
      nodesRef.current = nodes;
      packetsRef.current = [];
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

    const LINK_DIST = 138;
    const activeLinks: Array<[number, number, number]> = []; // [i, j, distanceFactor] reused each frame

    const maybeSpawnPacket = () => {
      // Keep a light, capped population of "data flowing through the mesh" packets.
      if (packetsRef.current.length >= 6 || activeLinks.length === 0) return;
      if (Math.random() > 0.045) return;
      const [i, j] = activeLinks[Math.floor(Math.random() * activeLinks.length)];
      const a = nodesRef.current[i];
      const b = nodesRef.current[j];
      packetsRef.current.push({
        from: i,
        to: j,
        t: 0,
        speed: 0.012 + Math.random() * 0.014,
        hue: (a.hue + b.hue) / 2,
      });
    };

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

      // Update nodes
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
        n.x = Math.max(0, Math.min(w, n.x));
        n.y = Math.max(0, Math.min(h, n.y));
        n.pulse = (n.pulse + n.pulseSpeed) % 1;

        // Cursor attraction — hubs resist it slightly, feels more "anchored"
        if (mouseRef.current.active) {
          const dx = mouseRef.current.x - n.x;
          const dy = mouseRef.current.y - n.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 180 * 180) {
            const f = n.hub ? 0.0003 : 0.0006;
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

      // Links (collect active ones for data-packet spawning as we go)
      activeLinks.length = 0;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < LINK_DIST) {
            const t = 1 - d / LINK_DIST;
            const bothHubs = a.hub && b.hub;
            const hue = (a.hue + b.hue) / 2;
            ctx.strokeStyle = `hsla(${hue}, 90%, 60%, ${(bothHubs ? 0.32 : 0.18) * t})`;
            ctx.lineWidth = bothHubs ? 1.4 : 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            activeLinks.push([i, j, t]);
          }
        }
      }

      // Data packets: bright dots traveling along live links — the mesh "thinking"
      maybeSpawnPacket();
      const packets = packetsRef.current;
      for (let p = packets.length - 1; p >= 0; p--) {
        const pk = packets[p];
        const a = nodes[pk.from];
        const b = nodes[pk.to];
        if (!a || !b) { packets.splice(p, 1); continue; }
        pk.t += pk.speed;
        if (pk.t >= 1) { packets.splice(p, 1); continue; }
        const px = a.x + (b.x - a.x) * pk.t;
        const py = a.y + (b.y - a.y) * pk.t;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, 7);
        grad.addColorStop(0, `hsla(${pk.hue}, 100%, 72%, 0.95)`);
        grad.addColorStop(1, `hsla(${pk.hue}, 100%, 72%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `hsla(${pk.hue}, 100%, 85%, 0.95)`;
        ctx.beginPath();
        ctx.arc(px, py, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // Nodes with pulse glow — hubs render as bright anchor cores
      for (const n of nodes) {
        const glow = 0.6 + 0.4 * Math.sin(n.pulse * Math.PI * 2);
        const rr = n.r * (1 + (n.hub ? 0.4 : 0.25) * glow);
        const haloMult = n.hub ? 9 : 6;
        const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, rr * haloMult);
        grad.addColorStop(0, `hsla(${n.hue}, 95%, 65%, ${(n.hub ? 0.7 : 0.55) * glow})`);
        grad.addColorStop(1, `hsla(${n.hue}, 95%, 65%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(n.x, n.y, rr * haloMult, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `hsl(${n.hue}, 90%, ${n.hub ? 60 : 55}%)`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, rr, 0, Math.PI * 2);
        ctx.fill();

        if (n.hub) {
          ctx.strokeStyle = `hsla(${n.hue}, 100%, 85%, ${0.5 * glow})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(n.x, n.y, rr + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
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

      {/* Slow radar-style sweep across the mesh — reinforces "actively scanning/thinking" */}
      {!reduced && (
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none opacity-[0.35] mix-blend-plus-lighter animate-[spin_9s_linear_infinite]"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, hsla(190,95%,65%,0.22) 12deg, transparent 26deg, transparent 360deg)",
          }}
        />
      )}

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
        </div>

        {/* Center reactor core — the main attraction */}
        <div className="flex items-center justify-center">
          <div className="pointer-events-auto relative flex flex-col items-center">
            <div className="relative h-28 w-28 md:h-32 md:w-32 flex items-center justify-center">
              {/* Outer halo */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[hsl(190,95%,60%)] via-[hsl(260,85%,60%)] to-[hsl(320,85%,60%)] blur-2xl opacity-40 animate-pulse" />

              {/* Rotating reactor rings */}
              {!reduced && (
                <>
                  <div className="absolute inset-0 rounded-full border-2 border-dashed border-primary/40 animate-[spin_14s_linear_infinite]" />
                  <div className="absolute inset-2 rounded-full border border-dotted border-secondary/50 animate-[spin_10s_linear_infinite_reverse]" />
                </>
              )}

              {/* Orbiting capability glyphs — vision · speed · trust */}
              {!reduced && (
                <div className="absolute inset-[-6px] animate-[spin_16s_linear_infinite]">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 animate-[spin_16s_linear_infinite_reverse]">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-md border border-border/60">
                      <Sparkles className="h-3 w-3 text-[hsl(190,90%,50%)]" />
                    </span>
                  </div>
                </div>
              )}
              {!reduced && (
                <div className="absolute inset-[-6px] animate-[spin_16s_linear_infinite] [animation-delay:-5.3s]">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 animate-[spin_16s_linear_infinite_reverse] [animation-delay:-5.3s]">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-md border border-border/60">
                      <Zap className="h-3 w-3 text-[hsl(260,85%,55%)]" />
                    </span>
                  </div>
                </div>
              )}
              {!reduced && (
                <div className="absolute inset-[-6px] animate-[spin_16s_linear_infinite] [animation-delay:-10.6s]">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 animate-[spin_16s_linear_infinite_reverse] [animation-delay:-10.6s]">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-md border border-border/60">
                      <ShieldCheck className="h-3 w-3 text-[hsl(320,80%,55%)]" />
                    </span>
                  </div>
                </div>
              )}

              {/* Core — dark glass reactor housing with cinematic rim light,
                  chromatic hologram split, and power-surge pulses. */}
              <div className="relative h-16 w-16 md:h-[4.5rem] md:w-[4.5rem]">
                {/* Expanding energy-discharge rings (arc-reactor power surge) */}
                {!reduced && (
                  <>
                    <span className="absolute inset-0 rounded-full border border-[hsl(190,95%,60%)]/70 animate-[ping_2.8s_cubic-bezier(0,0,0.2,1)_infinite]" />
                    <span className="absolute inset-0 rounded-full border border-[hsl(320,85%,60%)]/60 animate-[ping_2.8s_cubic-bezier(0,0,0.2,1)_infinite] [animation-delay:-1.4s]" />
                  </>
                )}

                <div className="relative h-full w-full rounded-full overflow-hidden shadow-[0_10px_40px_-8px_rgba(0,0,0,0.55)] ring-4 ring-white">
                  {/* Deep glass housing — the "chamber" the core sits in */}
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_28%,hsl(258,55%,20%),hsl(258,70%,6%)_72%)]" />
                  {/* Brand energy suffusing the glass */}
                  <div className="absolute inset-0 bg-gradient-to-br from-[hsl(190,95%,55%)]/35 via-[hsl(260,85%,55%)]/25 to-[hsl(320,85%,55%)]/35 mix-blend-screen" />

                  {/* Rim light sweep — simulates a rotating studio key light on a 3D object */}
                  {!reduced && (
                    <div
                      className="absolute inset-0 animate-[spin_5s_linear_infinite]"
                      style={{
                        background:
                          "conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.95) 6deg, transparent 18deg, transparent 360deg)",
                      }}
                    />
                  )}

                  {/* Chromatic hologram-split ghosts (subtle RGB fringe, sci-fi projection feel) */}
                  {!reduced && (
                    <>
                      <Brain className="absolute inset-0 m-auto h-8 w-8 md:h-9 md:w-9 -translate-x-[1.5px] text-[hsl(190,100%,60%)] opacity-60" />
                      <Brain className="absolute inset-0 m-auto h-8 w-8 md:h-9 md:w-9 translate-x-[1.5px] text-[hsl(320,100%,62%)] opacity-60" />
                    </>
                  )}

                  {/* Primary core glyph — bright, backlit, breathing */}
                  <Brain className="absolute inset-0 m-auto h-8 w-8 md:h-9 md:w-9 text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.85)] drop-shadow-[0_0_16px_rgba(147,197,253,0.65)] animate-[pulse_3s_ease-in-out_infinite]" />

                  {/* Specular glass highlight */}
                  <div className="absolute -top-2.5 -left-2 h-7 w-7 rounded-full bg-white/35 blur-md" />
                </div>
              </div>
            </div>
            <p className="mt-3 font-display font-extrabold text-base md:text-lg tracking-tight text-foreground">
              AI Nexus
            </p>
            <p className="text-[11px] text-muted-foreground">South Africa's living catalogue — thinking in real time</p>
          </div>
        </div>

        {/* Bottom stat strip -- real counts, fetched from the catalogue */}
        <div className="pointer-events-auto grid grid-cols-3 gap-2">
          <StatChip icon={<Sparkles className="h-3 w-3" />} label="Live SKUs" value={live.skus === null ? "…" : live.skus.toLocaleString("en-ZA")} />
          <StatChip icon={<Zap className="h-3 w-3" />} label="AI-ready" value={live.ai === null ? "…" : live.ai.toLocaleString("en-ZA")} />
          <StatChip icon={<RefreshCw className="h-3 w-3" />} label="Distributor Sync" value="Hourly" />
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
