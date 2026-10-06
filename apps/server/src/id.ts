import { ID_ALPHABET, ID_LENGTH } from "@xsblx/api/id";
import { customAlphabet } from "nanoid";

/**
 * The one id generator (ADR 0017). Every service and the yielded D1 ports call
 * this, so it is plain infrastructure and not a feature slice.
 *
 * `customAlphabet` uses the same hardware CSPRNG as `nanoid()` and rejection-
 * samples, so trimming the alphabet to 62 characters costs no uniformity.
 */
export const newId: () => string = customAlphabet(ID_ALPHABET, ID_LENGTH);
