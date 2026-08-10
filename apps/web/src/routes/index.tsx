import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@xsblx/ui/components/button";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">Hello World</h1>
      <Button>Button</Button>
    </div>
  );
}
