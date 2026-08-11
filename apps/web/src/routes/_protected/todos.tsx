import type { TodoId, TodoStatus } from "@xsblx/api/todos/schema";
import { TodoCreateStandard } from "@xsblx/api/todos/schema";
import { Button } from "@xsblx/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@xsblx/ui/components/card";
import { Checkbox } from "@xsblx/ui/components/checkbox";
import { Field, FieldError } from "@xsblx/ui/components/field";
import { Input } from "@xsblx/ui/components/input";
import { useForm } from "@tanstack/react-form";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api, eq } from "@/lib/api-client";
import { signOut, useSession } from "@/lib/auth-client";

export const Route = createFileRoute("/_protected/todos")({ component: Todos });

const todosKey = ["todos"];

const PAGE_SIZE = 20;

const STATUSES = ["all", "open", "done"] as const satisfies ReadonlyArray<TodoStatus>;

/**
 * The list is cursor-paginated, so the client follows `nextCursor` and never
 * computes an offset. The status is part of the query key — a different filter
 * is a different list, not a refetch of the same one.
 */
const listTodos = (status: TodoStatus) =>
  eq.infiniteQueryOptions({
    queryKey: [...todosKey, status],
    queryFn: ({ pageParam }) =>
      api((client) =>
        client.todos.list({
          query: { status, limit: PAGE_SIZE, cursor: pageParam ?? undefined },
        }),
      ),
    initialPageParam: null as TodoId | null,
    // `null` from the server means the last page; TanStack reads that as "no
    // next page" and disables `fetchNextPage`.
    getNextPageParam: (page) => page.nextCursor,
  });

function Todos() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<TodoStatus>("all");
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    listTodos(status),
  );
  const todos = data?.pages.flatMap((page) => page.items);
  // `_protected` already guarantees a session before this renders.
  const { data: session } = useSession();

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

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-8">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm">{session?.user.email}</span>
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

          <div className="flex gap-1">
            {STATUSES.map((option) => (
              <Button
                key={option}
                variant={option === status ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatus(option)}
              >
                {option}
              </Button>
            ))}
          </div>

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

          {hasNextPage ? (
            <Button
              variant="outline"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
