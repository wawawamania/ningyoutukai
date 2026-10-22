import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { auth, webOrigin } from "./auth";
import { errorHandler } from "./lib/error-handler";
import { calendarRoutes } from "./routes/calendar";
import { invitationRoutes } from "./routes/invitation";
import { memberRoutes } from "./routes/member";
import { productRoutes } from "./routes/product";
import { productManageRoutes } from "./routes/product-manage";
import { productTreeRoutes } from "./routes/product-tree";
import { taskRoutes } from "./routes/task";
import { assignKindRoutes } from "./routes/task/assign-kind";
import { deleteTaskRoutes } from "./routes/task/delete-task";
import { taskKindRoutes } from "./routes/task-kind";

export const app = new Elysia()
  .use(cors({ origin: webOrigin, credentials: true }))
  .use(
    openapi({
      provider: "swagger-ui",
      path: "/swagger",
      documentation: {
        info: { title: "人形使い API", version: "0.1.0" },
      },
    })
  )
  .use(errorHandler)
  .use(calendarRoutes)
  .use(productRoutes)
  .use(productTreeRoutes)
  .use(taskRoutes)
  .use(productManageRoutes)
  .use(invitationRoutes)
  .use(memberRoutes)
  .use(taskKindRoutes)
  .use(assignKindRoutes)
  .use(deleteTaskRoutes)
  .all("/api/auth/*", ({ request }) => auth.handler(request), { parse: "none", detail: { hide: true } })
  .get("/", () => "Hello Elysia");
