import { app } from "./app";

app.listen(Number(process.env.PORT ?? 3001));

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
