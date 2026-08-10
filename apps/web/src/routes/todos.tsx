import type { Todo, TodoId } from "@xsblx/api/domain/todo";
import { TodoCreateStandard } from "@xsblx/api/domain/todo";
import { Button } from "@xsblx/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@xsblx/ui/components/card";
import { Checkbox } from "@xsblx/ui/components/checkbox";
import { Field, FieldError } from "@xsblx/ui/components/field";
import { Input } from "@xsblx/ui/components/input";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { runApi } from "@/lib/api-client";

export const Route = createFileRoute("/todos")({
  // Loader results are serialized to the browser, and the serializer only handles
  // plain values — a `Schema.Class` instance throws. Spread domain objects into
  // plain ones at this boundary; `Date` fields survive, `DateTime.Utc` would not.
  loader: () =>
    runApi((client) => client.todos.list()).then((todos) => todos.map((todo) => ({ ...todo }))),
  component: Todos,
});

function Todos() {
  const todos = Route.useLoaderData();
  const router = useRouter();

  // Reloading the route after a mutation keeps the server as the single source
  // of truth. Swap for optimistic updates only when latency is a real problem.
  const refresh = () => router.invalidate();

  const form = useForm({
    defaultValues: { title: "" },
    // The API's own schema, as a Standard Schema. Validation rules are never
    // restated here — change `TodoCreate` and both sides follow.
    validators: { onSubmit: TodoCreateStandard },
    onSubmit: async ({ value, formApi }) => {
      await runApi((client) => client.todos.create({ payload: value }));
      formApi.reset();
      await refresh();
    },
  });

  const toggle = async (todo: Todo) => {
    await runApi((client) =>
      client.todos.update({ params: { id: todo.id }, payload: { completed: !todo.completed } }),
    );
    await refresh();
  };

  const remove = async (id: TodoId) => {
    await runApi((client) => client.todos.remove({ params: { id } }));
    await refresh();
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-8">
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
            {todos.map((todo) => (
              <li key={todo.id} className="flex items-center gap-3">
                <Checkbox checked={todo.completed} onCheckedChange={() => void toggle(todo)} />
                <span className={todo.completed ? "flex-1 line-through opacity-60" : "flex-1"}>
                  {todo.title}
                </span>
                <Button variant="ghost" size="sm" onClick={() => void remove(todo.id)}>
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
