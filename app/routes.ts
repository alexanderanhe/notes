import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("auth/register", "routes/auth.register.tsx"),
  route("auth/login", "routes/auth.login.tsx"),
  route("auth/verify-email", "routes/auth.verify-email.tsx"),
  route("auth/logout", "routes/auth.logout.tsx"),
  route("api/auth/register", "routes/api.auth.register.ts"),
  route("api/auth/login", "routes/api.auth.login.ts"),
  route("api/notes", "routes/api.notes.ts"),
  route("api/notes/:noteId", "routes/api.notes.$noteId.ts"),
  route("api/vault", "routes/api.vault.ts"),
  route("app", "routes/app.tsx"),
] satisfies RouteConfig;
