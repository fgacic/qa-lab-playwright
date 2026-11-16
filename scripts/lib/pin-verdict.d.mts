export interface PinResult {
  status?: string;
  last?: string;
  id?: string;
  absence?: boolean;
  specFile: string;
  errors: { message: string; file?: string }[];
}
export type Verdict = { reproduces?: true; fixed?: true; notVerified?: string; other?: string };
export const strip: (text?: string) => string;
export const escapeRegExp: (text: string) => string;
export const mentions: (message: string, id: string) => boolean;
export function firstLine(message: string): string;
export function matchedNoElement(message: string): boolean;
export function whyNotThePin(result: PinResult): string | undefined;
export function judge(result: PinResult): Verdict;
export function afterRerun(first: Verdict, second: Verdict | undefined): Verdict;
