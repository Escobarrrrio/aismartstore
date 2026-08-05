import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split the vendors that never change away from the app code that
        // changes on every deploy. Before this, one 1,074KB chunk held React,
        // the router, the Supabase client and the whole UI kit together with
        // our own code -- so shipping a one-line copy fix invalidated the
        // entire download for every returning visitor.
        //
        // Split by how often something changes, not by size: these three move
        // only on a dependency upgrade, so a returning shopper re-downloads
        // the app chunk alone.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-supabase": ["@supabase/supabase-js"],
          "vendor-ui": ["lucide-react", "embla-carousel-react", "date-fns"],
        },
      },
    },
    // The warning has done its job -- it pointed at a real problem that is now
    // addressed. Left near the largest remaining chunk so it fires again if
    // something new creeps in.
    chunkSizeWarningLimit: 700,
  },
}));
