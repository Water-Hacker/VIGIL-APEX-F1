/**
 * Opaque `Secret<T>` type — discourages accidental logging or serialisation.
 *
 * Usage:
 *   const apiKey = await vault.read<string>('secret/data/anthropic', 'api_key');
 *   //  type: Secret<string>
 *   const headers = { 'x-api-key': expose(apiKey) };
 *
 * The `toString()` and `JSON.stringify()` of a Secret returns "[Secret]".
 * pino redacts the field by name regardless.
 */

const __secret = Symbol('vigil.secret');

export interface Secret<T> {
  readonly [__secret]: T;
  toString(): string;
  toJSON(): string;
}

export function wrapSecret<T>(value: T): Secret<T> {
  return {
    [__secret]: value,
    toString: () => '[Secret]',
    toJSON: () => '[Secret]',
  };
}

/** Extract the underlying value. Use sparingly. */
export function expose<T>(s: Secret<T>): T {
  return s[__secret];
}

export function isSecret(x: unknown): x is Secret<unknown> {
  return typeof x === 'object' && x !== null && __secret in x;
}
