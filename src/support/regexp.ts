/** Escapes a string so it matches itself literally inside a RegExp (a payload full of `(`, `.` and `$` included). */
export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
