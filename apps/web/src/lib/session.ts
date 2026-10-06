import { useQuery } from "@tanstack/react-query";
import { auth, eq } from "@/lib/api-client";

/**
 * The current session, as a TanStack query (ADR 0010). Sign-in, sign-up and
 * sign-out invalidate this key; `_protected` and `_guest` gate on it.
 */
export const sessionKey = ["session"];

export const sessionQuery = eq.queryOptions({
  queryKey: sessionKey,
  queryFn: () => auth((client) => client.getSession()),
});

export const useSession = () => useQuery(sessionQuery);
