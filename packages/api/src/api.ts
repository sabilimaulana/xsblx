import { HttpApi, OpenApi } from "effect/unstable/httpapi";
import { HealthApiGroup } from "./groups/health.ts";
import { TodosApiGroup } from "./groups/todos.ts";

export class Api extends HttpApi.make("api")
  .add(HealthApiGroup)
  .add(TodosApiGroup)
  .annotateMerge(OpenApi.annotations({ title: "xsblx API" })) {}
