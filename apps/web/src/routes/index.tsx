import { Link, createFileRoute } from "@tanstack/react-router";
import { buttonVariants } from "@xsblx/ui/components/button";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">Hello World</h1>
      <div className="flex gap-2">
        <Link to="/signin" className={buttonVariants()}>
          Sign in
        </Link>
        <Link to="/signup" className={buttonVariants({ variant: "outline" })}>
          Sign up
        </Link>
      </div>
    </div>
  );
}
