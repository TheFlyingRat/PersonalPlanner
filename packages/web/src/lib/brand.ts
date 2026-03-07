import { BRAND } from '@cadence/shared';

// Re-export for convenient single import in pages
export const APP_NAME = BRAND.name;
export const pageTitle = (page: string) => `${page} - ${BRAND.name}`;
