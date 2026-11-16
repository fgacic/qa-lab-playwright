export function probe(target: { api: string; ui: string }): Promise<string>;
export function signInOnce(target: { api: string; admin: { email: string; password: string } }): Promise<string>;
export function waitForToolshop(target: { api: string; ui: string; admin?: { email: string; password: string }; timeoutMs: number; intervalMs?: number }): Promise<string>;
