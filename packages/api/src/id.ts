import { Schema } from "effect";

/**
 * Every generated id in the system is a 21-character nanoid over this alphabet
 * (ADR 0017). `-` and `_` are deliberately excluded from nanoid's default URL
 * alphabet: ids travel in path segments, query strings, CSV exports and log
 * greps, and a leading `-` reads as a flag to enough tools that it is not worth
 * the two extra bits.
 *
 * 62^21 ≈ 2^125, so the collision probability matches UUIDv4's without the
 * hyphens or the 36 characters.
 */
export const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const ID_LENGTH = 21;

const ID_PATTERN = new RegExp(`^[${ID_ALPHABET}]{${ID_LENGTH}}$`);

/**
 * The shape of an id on the wire. Brand it per feature (`Schema.brand`) so a
 * todo id is not assignable to a user id.
 */
export const IdString = Schema.String.check(
  Schema.isPattern(ID_PATTERN, { message: `Expected a ${ID_LENGTH}-character id` }),
);
