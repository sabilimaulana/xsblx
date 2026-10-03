import { HttpApi, OpenApi } from "effect/http-api";
import { HealthApiGroup } from "./features/health/group.ts";
import { TodosApiGroup } from "./features/todos/group.ts";

export class Api extends HttpApi.make("api")
  .add(HealthApiGroup)
  .add(TodosApiGroup)
  .annotateMerge(OpenApi.annotations({ title: "xsblx API" })) {}
