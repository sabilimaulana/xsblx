import type { TodoId } from "@xsblx/api/domain/todo";
import { TodoCreateStandard } from "@xsblx/api/domain/todo";
import { Button } from "@xsblx/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@xsblx/ui/components/card";
import { Checkbox } from "@xsblx/ui/components/checkbox";
import { Field, FieldError } from "@xsblx/ui/components/field";
import { Input } from "@xsblx/ui/components/input";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, createFileRoute } from "@tanstack/react-router";
import { api, eq } from "@/lib/api-client";
import { signOut, useSession } from "@/lib/auth-client";

export const Route = createFileRoute("/todos")({
  // The session cookie lives in the browser, so the API can only be called from
  // there: an SSR pass would call it without credentials and get a 401.
  ssr: false,
  component: Todos,
});

const todosKey = ["todos"];

const listTodos = eq.queryOptions({
  queryKey: todosKey,
  queryFn: () => api((client) => client.todos.list()),
});

function Todos() {
  const queryClient = useQueryClient();
  const { data: todos } = useQuery(listTodos);
  // The session cookie only exists in the browser, so the gate is client-side.
  // The API itself is closed too — handlers take the owner from the session.
  const { data: session, isPending } = useSession();

  // Refetching the list after a mutation keeps the server as the single source
  // of truth. Swap for optimistic updates only when latency is a real problem.
  const refresh = () => queryClient.invalidateQueries({ queryKey: todosKey });

  const create = useMutation(
    eq.mutationOptions({
      mutationKey: ["todos", "create"],
      mutationFn: (payload: { title: string }) => api((client) => client.todos.create({ payload })),
      onSuccess: refresh,
    }),
  );

  const update = useMutation(
    eq.mutationOptions({
      mutationKey: ["todos", "update"],
      mutationFn: (variables: { id: TodoId; completed: boolean }) =>
        api((client) =>
          client.todos.update({
            params: { id: variables.id },
            payload: { completed: variables.completed },
          }),
        ),
      onSuccess: refresh,
    }),
  );

  const remove = useMutation(
    eq.mutationOptions({
      mutationKey: ["todos", "remove"],
      mutationFn: (id: TodoId) => api((client) => client.todos.remove({ params: { id } })),
      onSuccess: refresh,
    }),
  );

  const form = useForm({
    defaultValues: { title: "" },
    // The API's own schema, as a Standard Schema. Validation rules are never
    // restated here — change `TodoCreate` and both sides follow.
    validators: { onSubmit: TodoCreateStandard },
    onSubmit: async ({ value, formApi }) => {
      await create.mutateAsync(value);
      formApi.reset();
    },
  });

  if (isPending) return null;
  if (!session) return <Navigate to="/signin" />;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-8">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm">{session.user.email}</span>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Todos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field name="title">
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                  <div className="flex gap-2">
                    <Input
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder="What needs doing?"
                    />
                    <form.Subscribe selector={(state) => state.isSubmitting}>
                      {(isSubmitting) => (
                        <Button type="submit" disabled={isSubmitting}>
                          Add
                        </Button>
                      )}
                    </form.Subscribe>
                  </div>
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          </form>

          <ul className="flex flex-col gap-2">
            {todos?.map((todo) => (
              <li key={todo.id} className="flex items-center gap-3">
                <Checkbox
                  checked={todo.completed}
                  onCheckedChange={() => update.mutate({ id: todo.id, completed: !todo.completed })}
                />
                <span className={todo.completed ? "flex-1 line-through opacity-60" : "flex-1"}>
                  {todo.title}
                </span>
                <Button variant="ghost" size="sm" onClick={() => remove.mutate(todo.id)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
