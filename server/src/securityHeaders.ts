import helmet, { type HelmetOptions } from "helmet";

/**
 * Upgrading every request to https is only right when the instance is served over https. On a plain http address
 * (localhost, a home network) Safari would upgrade scripts and images to an https origin that does not exist.
 */
export function securityHeaderOptions(publicUrl: string): HelmetOptions {
  const servedOverHttps = new URL(publicUrl).protocol === "https:";
  return {
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'"],
        "img-src": ["'self'", "data:", "https:", "http:"],
        "upgrade-insecure-requests": servedOverHttps ? [] : null,
      },
    },
    strictTransportSecurity: servedOverHttps,
  };
}
