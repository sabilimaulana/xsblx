import { createFileRoute } from "@tanstack/react-router";
import { AuthForm } from "@/components/auth-form";

export const Route = createFileRoute("/signin")({ component: () => <AuthForm mode="sign-in" /> });
