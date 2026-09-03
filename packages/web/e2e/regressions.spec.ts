/**
 * Black-box regression specs for the three SPA fixes shipped in
 * 56c1a49 + 57bf5eb. Each `describe` pins one fix; failure names in
 * CI output identify which fix regressed.
 *
 *   describe(A) — nginx exact-match `location = /dashboard` block:
 *                 bare /dashboard must NOT 301 to /dashboard/.
 *   describe(B) — <RequireAuth/> route gate: unauthenticated visits
 *                 to protected paths must redirect to /login.
 *   describe(C) — <ProtectedShell/> shared layout: the [data-testid=
 *                 "app-shell"] DOM node must survive navigation
 *                 (proves AppShell mounts ONCE per session, not per
 *                 route).
 *
 * Demo creds: `operator@surakkha.test` / `demo-operator` per
 * `packages/api/src/auth/router.spec.ts:76`. The Operator role has
 * access to "Monitor"-group routes (Dashboard, Incidents) but is
 * blocked from "Admin"-group routes — useful for describe(B)'s
 * admin-path test which also exercises the gate.
 */
import { expect, test } from "@playwright/test";

test.describe("A — /dashboard reload preserves the bare path (nginx exact-match block)", () => {
  test("bare /dashboard reload does not 301 to /dashboard/", async ({ request }) => {
    // Use the bare HTTP request context (not `page`) so we test nginx
    // in isolation. A browser visit would also run the SPA's
    // RequireAuth gate, which redirects unauthenticated visitors to
    // /login — that obscures the nginx-level assertion. The exact-
    // match `location = /dashboard` block serves the SPA shell
    // regardless of who calls.
    //
    // Pre-fix: nginx issued 301 /dashboard → /dashboard/, browser
    // followed, and the SPA's <BrowserRouter> pathname normalised.
    // Post-fix: nginx serves index.html (200 + text/html) directly.
    //
    // `maxRedirects: 0` is critical — without it Playwright silently
    // follows the 301 and reports the final 200, which would mask the
    // regression. With it, the test sees the actual 301 and fails.
    const response = await request.get("/dashboard", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
    expect(response.headers()["location"]).toBeUndefined();
  });
});

test.describe("B — unauthenticated protected paths redirect to /login (RequireAuth gate)", () => {
  test("unauthenticated /dashboard redirects to /login", async ({ page, context }) => {
    // Fresh context = empty localStorage (no persisted token) AND
    // empty cookie jar. The `surakkha.access_token` localStorage key
    // (set by `packages/web/src/auth/tokenStore.readPersisted()`)
    // would let a stale token slip past RequireAuth; clearing the
    // context ensures the gate sees a null accessToken.
    await context.clearCookies();

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("unauthenticated /admin/simulator redirects to /login (Admin-only gate)", async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    // Even Admin-only paths must hit /login (not /admin/simulator with
    // a 401). RequireAuth runs before RbacRoute, so an unauthenticated
    // operator sees the login form rather than a denial page.
    await page.goto("/admin/simulator");
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("unauthenticated deep link preserves the request path via state.from", async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    // Deep-link bounce-back is the whole point of RequireAuth's
    // `state.from` preservation. After login, the operator should
    // land back at /incidents/<uuid>, not at /dashboard.
    await page.goto("/incidents/00000000-0000-4000-8000-000000000001");
    await expect(page).toHaveURL(/\/login(?:\?|$)/);

    // Sign in and confirm we bounce back to the original path.
    await page.getByLabel("Email").fill("operator@surakkha.test");
    await page.getByLabel("Password").fill("demo-operator");
    await page.getByTestId("login-submit").click();

    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe("/incidents/00000000-0000-4000-8000-000000000001");
  });
});

test.describe("C — sidebar/shell persists across navigation (ProtectedShell shared layout)", () => {
  test("after login, the app-shell DOM node survives Dashboard → Incidents → Dashboard", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill("operator@surakkha.test");
    await page.getByLabel("Password").fill("demo-operator");
    await page.getByTestId("login-submit").click();

    // Post-login bounce lands at /dashboard.
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/dashboard\/?$/);
    await expect(page.getByTestId("dashboard-root")).toBeVisible();

    // The fix: <RequireAuth><ProtectedShell><AppShell/></ProtectedShell></RequireAuth>
    // in main.tsx mounts AppShell ONCE per session. Before the fix,
    // every <Route element={…}> inlined its own <AppShell> wrapper, so
    // React Router unmounted+remounted it on every nav. The element
    // handle below would point at a detached node, and `isConnected`
    // would flip to false on the next navigation.
    //
    // Grab the live DOM node, not the locator, so we can ask the
    // browser "is this exact node still in the tree?" after each nav.
    const shell = await page.getByTestId("app-shell").elementHandle();
    expect(shell, "app-shell element handle must be available after login").not.toBeNull();

    // Dashboard → Incidents.
    await page.getByRole("link", { name: "Incidents" }).click();
    await expect(page.getByTestId("kanban-board-root")).toBeVisible();
    expect(
      await shell!.evaluate((el) => el.isConnected),
      "app-shell DOM node must survive /dashboard → /incidents navigation",
    ).toBe(true);

    // Incidents → Dashboard.
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page.getByTestId("dashboard-root")).toBeVisible();
    expect(
      await shell!.evaluate((el) => el.isConnected),
      "app-shell DOM node must survive /incidents → /dashboard navigation",
    ).toBe(true);
  });
});
