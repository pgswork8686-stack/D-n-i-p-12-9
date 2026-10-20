import "reflect-metadata";
import * as fs from "fs";
import * as path from "path";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ROLE_PERMISSION_MAP } from "@nexus/database";
import { AuthGuard } from "./auth.guard";
import { PermissionsGuard } from "./permissions.guard";
import { PERMISSIONS_KEY } from "./require-permissions.decorator";

/**
 * Customers read their own orders, tickets, licenses... through routes that need NO permission and check ownership
 * in the service. Permissions therefore gate STAFF routes only, and the customer role must never satisfy one:
 * if it does, every customer can read every other customer's data (this happened with order.read, ticket.read and
 * invoice.read, which made GET /admin/orders and /admin/tickets — internal notes included — open to customers).
 */

/** Routes that are meant for customers although they declare a permission (diagnostic RBAC probe). */
const CUSTOMER_ROUTES = new Set(["RbacTestController.testCustomer"]);
/** Admin routes that check permissions inside the handler instead of with @RequirePermissions. */
const INLINE_CHECKED = new Set(["PaymentReconciliationController.list", "PaymentReconciliationController.get"]);

interface Route {
  id: string;
  paths: string[];
  permissions: string[];
  guards: unknown[];
}

/** Every non-test source file that declares a controller, whatever it is named. */
function controllerFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(full);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".spec.ts")) return [];
    return /@Controller\(/.test(fs.readFileSync(full, "utf8")) ? [full] : [];
  });
}

function collectRoutes(): Route[] {
  const routes: Route[] = [];
  const src = path.resolve(__dirname, "../..");
  for (const file of controllerFiles(src)) {
    for (const exported of Object.values(jest.requireActual<Record<string, unknown>>(file))) {
      if (typeof exported !== "function") continue;
      const base = Reflect.getMetadata(PATH_METADATA, exported);
      if (base === undefined) continue;
      const bases = ([] as string[]).concat(base);
      const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, exported) ?? [];
      const classPermissions: string[] = Reflect.getMetadata(PERMISSIONS_KEY, exported) ?? [];
      const proto = (exported as { prototype: Record<string, unknown> }).prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === "constructor" || typeof handler !== "function") continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        const sub: string = Reflect.getMetadata(PATH_METADATA, handler) ?? "";
        const methodPermissions: string[] | undefined = Reflect.getMetadata(PERMISSIONS_KEY, handler);
        routes.push({
          id: `${(exported as { name: string }).name}.${name}`,
          paths: bases.map((b) => `/${[b, sub].filter((s) => s && s !== "/").join("/")}`.replace(/\/+/g, "/")),
          // Same resolution as PermissionsGuard (getAllAndOverride): the handler's list replaces the class's.
          permissions: methodPermissions ?? classPermissions,
          guards: [...classGuards, ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? [])],
        });
      }
    }
  }
  return routes;
}

const routes = collectRoutes();
const customer = new Set(ROLE_PERMISSION_MAP.customer);
const isAdmin = (r: Route) => r.paths.some((p) => /^\/(v1\/)?admin(\/|$)/.test(p));

describe("RBAC: the customer role can reach no staff route", () => {
  it("discovers the API routes", () => {
    expect(routes.length).toBeGreaterThan(150);
    expect(routes.filter(isAdmin).length).toBeGreaterThan(80);
  });

  it("no route that declares permissions is satisfied by the customer role's permissions", () => {
    const reachable = routes
      .filter((r) => r.permissions.length > 0 && !CUSTOMER_ROUTES.has(r.id))
      .filter((r) => r.permissions.every((p) => customer.has(p)))
      .map((r) => `${r.id} ${r.paths[0]} [${r.permissions.join(", ")}]`);
    expect(reachable).toEqual([]);
  });

  it("every admin or permission-declaring route authenticates, checks permissions and admin routes declare which ones", () => {
    // A @RequirePermissions without PermissionsGuard is never enforced, wherever the route lives.
    const unguarded = routes
      .filter((r) => isAdmin(r) || r.permissions.length > 0)
      .filter((r) => !r.guards.includes(AuthGuard) || !r.guards.includes(PermissionsGuard))
      .map((r) => r.id);
    const undeclared = routes
      .filter(isAdmin)
      .filter((r) => r.permissions.length === 0 && !INLINE_CHECKED.has(r.id))
      .map((r) => r.id);
    expect(unguarded).toEqual([]);
    expect(undeclared).toEqual([]);
  });
});
