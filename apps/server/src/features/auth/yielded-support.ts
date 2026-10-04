import { DateTime, Option } from "effect";

/**
 * Spike (yielded-auth): shared helpers for the hand-written D1 ports.
 *
 * Session `record` blobs round-trip yielded values (claims, provenance)
 * through JSON. DateTimes use the shared `$yieldedDateTime` millis codec —
 * millis in, `DateTime.Utc` out — because the tables store instants as
 * integers and the kernels hand back `DateTime` instances.
 *
 * `nowMillis` reads `Date.now()` directly: port methods must be `R = never`
 * (the kernel calls them in its own context), so Effect's `Clock`
 * (`R = Clock`) is unusable there — see the `globalDate` override in
 * `tsconfig.effect.json`.
 */

/** Epoch millis, the only clock the ports use. */
export const nowMillis = (): number => Date.now();

const dtMarker = "$yieldedDateTime";

const encodeDates = (value: unknown): unknown => {
  if (DateTime.isDateTime(value)) return { [dtMarker]: DateTime.toEpochMillis(value) };
  if (Array.isArray(value)) return value.map(encodeDates);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, encodeDates(entry)]),
    );
  }
  return value;
};

const dtReviver = (_key: string, value: unknown): unknown => {
  if (typeof value === "object" && value !== null && dtMarker in value) {
    const millis = (value as Record<string, unknown>)[dtMarker];
    return typeof millis === "number" ? dateTimeFromMillis(millis) : value;
  }
  return value;
};

export const toJson = (value: unknown): string => JSON.stringify(encodeDates(value));

export const fromJson = <A>(text: string): A => JSON.parse(text, dtReviver) as A;

/** Epoch millis back into a `DateTime.Utc` for session records. */
export const dateTimeFromMillis = (millis: number): DateTime.Utc =>
  Option.getOrThrow(DateTime.make(new Date(millis)));
