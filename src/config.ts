// Shared runtime configuration helpers

declare global {
  interface Window {
    __WIDGET_API_BASE__?: string;
  }
}

let apiBaseFromQuery: string | null = null;

if (typeof window !== 'undefined') {
  try {
    const params = new URLSearchParams(window.location.search);
    const queryBase = params.get('apiBase') || params.get('api_base');

    if (queryBase) {
      apiBaseFromQuery = new URL(queryBase, window.location.origin)
        .toString()
        .replace(/\/$/, '');

      // Expose it for the rest of the app
      window.__WIDGET_API_BASE__ = apiBaseFromQuery;
    }
  } catch {
    // ignore parsing errors and fall back to other sources
  }
}

// API base can be configured at runtime via /env.js (window.__WIDGET_API_BASE__),
// via query params (apiBase), or at build time via Vite env (VITE_API_BASE).
// As a last resort, fall back to the production prefix (/futuguru/api).
export const API_ENDPOINT =
  apiBaseFromQuery ||
  (typeof window !== 'undefined' && window.__WIDGET_API_BASE__) ||
  import.meta.env.VITE_API_BASE ||
  '/futuguru/api';