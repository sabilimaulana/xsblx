import { SignInStandard, SignUpStandard } from "@xsblx/api/domain/auth";
import { Button } from "@xsblx/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@xsblx/ui/components/card";
import { Field, FieldError, FieldLabel } from "@xsblx/ui/components/field";
import { Input } from "@xsblx/ui/components/input";
import { useForm } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { signIn, signUp } from "@/lib/auth-client";

/**
 * Sign-in and sign-up differ only by the `name` field and which Better Auth call
 * they make, so they share one component rather than two near-identical routes.
 */
export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const isSignUp = mode === "sign-up";

  const form = useForm({
    defaultValues: { name: "", email: "", password: "" },
    // Validated against the shared schema — the rules are never restated here.
    validators: { onSubmit: isSignUp ? SignUpStandard : SignInStandard },
    onSubmit: async ({ value }) => {
      setError(null);
      const result = isSignUp
        ? await signUp.email({ name: value.name, email: value.email, password: value.password })
        : await signIn.email({ email: value.email, password: value.password });

      if (result.error) {
        setError(result.error.message ?? "Something went wrong");
        return;
      }
      await navigate({ to: "/todos" });
    },
  });

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 p-8">
      <Card>
        <CardHeader>
          <CardTitle>{isSignUp ? "Create account" : "Sign in"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            {isSignUp && (
              <form.Field name="name">
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                    <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      autoComplete="name"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
            )}

            <form.Field name="email">
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                  <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="email"
                    autoComplete="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>

            <form.Field name="password">
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                  <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="password"
                    autoComplete={isSignUp ? "new-password" : "current-password"}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>

            {error !== null && <p className="text-destructive text-sm">{error}</p>}

            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" disabled={isSubmitting}>
                  {isSignUp ? "Create account" : "Sign in"}
                </Button>
              )}
            </form.Subscribe>
          </form>

          <p className="text-muted-foreground mt-4 text-sm">
            {isSignUp ? "Already have an account? " : "No account yet? "}
            <Link className="underline" to={isSignUp ? "/signin" : "/signup"}>
              {isSignUp ? "Sign in" : "Sign up"}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
