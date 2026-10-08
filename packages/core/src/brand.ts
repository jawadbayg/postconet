/** Editable product branding. Keep in sync with /brand/brand.json. */
export const brand = {
  appId: "app.postconet.studio",
  productName: "PostConet API Studio",
  shortName: "PostConet",
  protocolScheme: "postconet",
  tagline: "Professional API development and testing",
  vendor: "PostConet",
  copyright: "Copyright © PostConet",
  accent: "#2563EB",
  accentForeground: "#FFFFFF",
  website: "https://postconet.app",
  supportEmail: "support@postconet.app",
  oauthCallbackPath: "/oauth/callback",
  defaultUserAgent: "PostConetAPIStudio/0.1.0",
  icon: "resources/icons/postconet_logo.png"
} as const;

export type Brand = typeof brand;
