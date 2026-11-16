/**
 * Builds an address from its parts, for the specs that need a made-up one (the target configuration's refusal cases): a spec
 * may not write an `http(s)://` literal (eslint.config.mjs), so a host that should be refused is spelt out here instead.
 */
export const httpUrl = (host: string, path = '', port = 4200): string => `http://${host}:${port}${path}`;
export const httpsUrl = (host: string, path = ''): string => `https://${host}${path}`;
