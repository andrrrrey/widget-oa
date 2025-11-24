// Shared runtime configuration helpers

declare global {
  interface Window {
    __WIDGET_API_BASE__?: string;
  }
}

export const API_ENDPOINT =
  (typeof window !== 'undefined' && window.__WIDGET_API_BASE__) ||
  import.meta.env.VITE_API_BASE ||
  '/api';