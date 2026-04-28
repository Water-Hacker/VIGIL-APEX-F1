/**
 * Core ambient type utilities for VIGIL APEX.
 *
 * These types are imported widely; any change here forces a workspace rebuild.
 */

declare const __brand: unique symbol;

/**
 * `Brand<string, "Foo">` produces a nominal type that the compiler will treat
 * as distinct from `string` even if they share the same runtime shape.
 *
 * Used for IDs (FindingId, EntityId, etc.) so a `FindingId` cannot be passed
 * where an `EntityId` is expected.
 */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;

export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** Helper for exhaustive switch checks per SRD §20 strict-boolean discipline. */
export function assertNever(x: never, message?: string): never {
  throw new Error(message ?? `Unexpected case: ${JSON.stringify(x)}`);
}
