import { Navigate, Outlet, createFileRoute } from "@tanstack/react-router";
import { useSession } from "@/lib/auth-client";

/**
 * Routes that require a session. The session cookie lives in the browser, so
 * the gate is client-side and the layout is `ssr: false` — an SSR pass would
 * see no cookie and bounce every visitor to `/signin`. The API is closed too:
 * handlers take the owner from the session, never from a payload.
 */
export const Route = createFileRoute("/_protected")({ ssr: false, component: Protected });

function Protected() {
  const { data: session, isPending } = useSession();

  if (isPending) return null;
  if (!session) return <Navigate to="/signin" />;
  return <Outlet />;
}
