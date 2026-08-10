import { Navigate, Outlet, createFileRoute } from "@tanstack/react-router";
import { useSession } from "@/lib/auth-client";

/**
 * Routes only a signed-out visitor should see — sign-in, sign-up. Mirror of
 * `_protected`: same client-side session check, opposite verdict.
 */
export const Route = createFileRoute("/_guest")({ ssr: false, component: Guest });

function Guest() {
  const { data: session, isPending } = useSession();

  if (isPending) return null;
  if (session) return <Navigate to="/todos" />;
  return <Outlet />;
}
