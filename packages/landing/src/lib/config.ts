// Central config — all brand + external URLs in one place.
// Set VITE_* env vars at build time for production.

// Brand
export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Cadence';
export const TAGLINE = import.meta.env.VITE_TAGLINE || 'Your calendar, intelligently managed';
export const DESCRIPTION = import.meta.env.VITE_DESCRIPTION || `${APP_NAME} automatically schedules your habits, tasks, and focus time around your existing calendar. Open-source, self-hostable.`;

// URLs
export const APP_URL = import.meta.env.VITE_APP_URL || 'http://localhost:5173';
export const GITHUB_URL = import.meta.env.VITE_GITHUB_URL || 'https://github.com/anthropics/cadence';
export const TWITTER_URL = import.meta.env.VITE_TWITTER_URL || 'https://twitter.com/cadaboraHQ';

// Contact
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'support@cadence.app';
export const PRIVACY_EMAIL = import.meta.env.VITE_PRIVACY_EMAIL || 'privacy@cadence.app';
