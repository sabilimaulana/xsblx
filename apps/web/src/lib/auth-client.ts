import { createAuthClient } from "better-auth/react";

/**
 * Auth is the one part of the API that is not described by `@xsblx/api`: Better
 * Auth owns those routes and generates this client's types from the server
 * instance, so it talks to the server directly rather than through `runApi`.
 */
export const authClient = createAuthClient({
  baseURL: import.meta.env["VITE_API_URL"] ?? "http://localhost:3000",
  // The session cookie is cross-origin (web on 3001, API on 3000).
  fetchOptions: { credentials: "include" },
});

export const { signIn, signUp, signOut, useSession } = authClient;
