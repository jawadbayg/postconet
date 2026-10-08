import brandJson from "./brand.json" with { type: "json" };

export type Brand = {
  appId: string;
  productName: string;
  shortName: string;
  protocolScheme: string;
  tagline: string;
  vendor: string;
  copyright: string;
  accent: string;
  accentForeground: string;
  website: string;
  supportEmail: string;
  oauthCallbackPath: string;
  defaultUserAgent: string;
  icon: string;
};

export const brand: Brand = brandJson;
export default brand;
