// Shared runtime configuration helpers

declare global {
  interface Window {
    __WIDGET_API_BASE__?: string;
  }
}

// API base can be configured at runtime via /env.js (window.__WIDGET_API_BASE__)
// or at build time via Vite env (VITE_API_BASE). As a last resort, fall back
// to the legacy /api prefix.
export const API_ENDPOINT =
  (typeof window !== 'undefined' && window.__WIDGET_API_BASE__) ||
  import.meta.env.VITE_API_BASE ||
  '/api';