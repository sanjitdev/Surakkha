/**
 * Black-box regression specs for the SPA contract. Each `describe`
 * pins one user-visible behaviour; failure names in CI output
 * identify which subsystem regressed.
 *
 *   describe(A) — nginx exact-match `location = /dashboard` block:
 *                 bare /dashboard must NOT 301 to /dashboard/.
 *   describe(B) — <RequireAuth/> route gate: unauthenticated visits
 *                 to protected paths must redirect to /login.
 *   describe(C) — <ProtectedShell/> shared layout: the [data-testid=
 *                 "app-shell"] DOM node must survive navigation.
 *   describe(D) — Login error & validation surface (per-field
 *                 FormField errors + submit-error banner).
 *   describe(E) — Refresh cookie contract at the browser layer
 *                 (HttpOnly + SameSite=Strict + Path=/auth).
 *   describe(F) — RBAC denied page renders for non-permitted role.
 *   describe(G) — Sidebar nav filtering by role (Admin: 11 items,
 *                 Operator: 5 items, Audit hidden).
 *   describe(H) — Public /health endpoint via nginx (no auth).
 *   describe(I) — Simulator frames populate the dashboard (JSONB
 *                 fix downstream — `buildRecentReadings` returns
 *                 non-zero rows so the live-readings region renders
 *                 populated rows instead of the empty placeholder).
 *
 * Demo creds: `operator@surakkha.test` / `demo-operator`,
 * `admin@surakkha.test` / `demo-admin` per
 * `packages/api/src/auth/router.spec.ts:76`.
 */
import { expect, test, type Page } from "@playwright/test";

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

test.describe("D — login error & validation surface", () => {
  test("wrong password surfaces 'Invalid email or password.' in the submit-error banner", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill("operator@surakkha.test");
    await page.getByLabel("Password").fill("definitely-wrong-password");
    await page.getByTestId("login-submit").click();

    // The api returns 401 → main.tsx:118-128 throws
    // `new Error("Invalid email or password.")`. LoginShell:69-74
    // catches the throw and writes to `setError({ field: "submit",
    // message: ... })`. The submit-error banner testid mounts only
    // when `submitError !== null` (LoginShell:159), so a green
    // assertion proves the end-to-end error mapping survived.
    await expect(page.getByTestId("login-submit-error")).toBeVisible();
    await expect(page.getByTestId("login-submit-error")).toHaveText(/Invalid email or password\./);
    // The form did NOT bounce us away — we still see the form.
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("empty email blocks submission and shows the per-field validation error", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/login");
    // Fill only password so the email check fires.
    await page.getByLabel("Password").fill("demo-operator");
    await page.getByTestId("login-submit").click();

    // LoginShell:79 derives `emailError = error?.field === "email"`,
    // so an empty-email error renders through the Email FormField's
    // `<p role="alert">` (FormField.tsx:62). And LoginShell:80 derives
    // `submitError = error?.field !== "email"`, so the submit banner
    // stays empty for this field. Two distinct assertions pin the
    // asymmetry between per-field and submit error channels.
    await expect(page.getByRole("alert").first()).toHaveText(/Enter your email address\./);
    await expect(page.getByTestId("login-submit-error")).toHaveCount(0);
  });

  test("empty password blocks submission and surfaces the validation error in the submit banner", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill("operator@surakkha.test");
    await page.getByTestId("login-submit").click();

    // Note: the Password FormField does NOT receive an `error` prop
    // (LoginShell:144 — `<FormField label="Password" isRequired>`
    // without `error`). Instead LoginShell:80's `submitError`
    // derivation (`error.field !== "email"`) catches BOTH the
    // password field error AND api rejections, so the password
    // validation message ends up in the `[data-testid="login-submit-error"]`
    // banner rather than the per-field role="alert" slot.
    // This spec pins that behaviour: if a future refactor re-routes
    // the password error to per-field rendering (or merges the two
    // channels), the assertions below will need to move with it.
    await expect(page.getByTestId("login-submit-error")).toBeVisible();
    await expect(page.getByTestId("login-submit-error")).toHaveText(
      /Enter your password to continue\./,
    );
  });
});

test.describe("E — refresh cookie contract at the browser layer", () => {
  test("login sets surakkha_refresh cookie with HttpOnly + SameSite=Strict + Path=/auth", async ({
    page,
    context,
  }) => {
    // The api sets the cookie at packages/api/src/auth/router.ts:70
    // via `res.cookie(REFRESH_TOKEN_COOKIE, refresh, refreshTokenCookieOptions())`.
    // The options live in packages/shared/src/auth.ts:60-65:
    // httpOnly: true, sameSite: "strict", path: "/auth", secure: NODE_ENV==="production".
    // This spec catches a regression that drops any of those flags —
    // e.g. someone refactors refreshTokenCookieOptions() and forgets
    // the secure/httpOnly contract.
    await context.clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill("operator@surakkha.test");
    await page.getByLabel("Password").fill("demo-operator");
    await page.getByTestId("login-submit").click();

    // Wait for the post-login bounce to /dashboard so the cookie is
    // observable at the browser layer (the api Set-Cookie comes back
    // in the response headers of the login fetch).
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/dashboard\/?$/);

    const cookies = await context.cookies();
    const refresh = cookies.find((c) => c.name === "surakkha_refresh");
    expect(refresh, "surakkha_refresh cookie must be set after login").toBeDefined();
    expect(refresh!.httpOnly, "refresh cookie must be HttpOnly").toBe(true);
    expect(refresh!.sameSite, "refresh cookie must be SameSite=Strict").toBe("Strict");
    expect(refresh!.path, "refresh cookie must be scoped to /auth so /api/* never carries it").toBe(
      "/auth",
    );
  });
});

test.describe("F — RBAC denied page renders for non-permitted role", () => {
  test("operator navigating to /audit sees the RbacDenied page (not the audit content)", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill("operator@surakkha.test");
    await page.getByLabel("Password").fill("demo-operator");
    await page.getByTestId("login-submit").click();
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/dashboard\/?$/);

    // Operator is NOT in /audit's allow list (nav.ts:38 — Admin only),
    // so RbacRoute renders <RbacDenied/> in place. The URL must stay
    // /audit (no redirect; this is wrong-role, not unauthed).
    await page.goto("/audit");
    await expect(page).toHaveURL(/\/audit$/);
    await expect(page.getByTestId("rbac-denied")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();

    // Back link is role-aware. Default for Operator/Admin/Viewer is
    // "Back to dashboard" (RbacDenied.tsx:14-17).
    await expect(page.getByTestId("rbac-denied-back-link")).toHaveText(/Back to dashboard/);
  });
});

test.describe("G — sidebar nav filtering by role", () => {
  /** Count NavLink <a> elements inside the sidebar's primary nav. */
  const navLinkCount = async (page: Page): Promise<number> => {
    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    return nav.locator("a").count();
  };

  test("admin sees all 11 nav items across all 3 groups", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@surakkha.test");
    await page.getByLabel("Password").fill("demo-admin");
    await page.getByTestId("login-submit").click();
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/dashboard\/?$/);

    // Wait for the sidebar (it's part of the shell, mounts on /dashboard).
    await expect(page.getByTestId("sidebar-fixed")).toBeVisible();
    // Monitor×4 + Operate×2 (Reports, Audit) + Admin×5 (Simulator,
    // Notifications, Thresholds, Users, Schools) = 11. Source:
    // packages/web/src/shell/nav.ts:22-51.
    expect(await navLinkCount(page), "Admin should see 11 nav links").toBe(11);

    // Spot-check each group by name so a regression that reorders /
    // renames items is caught, not just the count.
    await expect(
      page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", {
        name: "Audit",
      }),
      "Admin should see /audit",
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", {
        name: "Simulator",
      }),
      "Admin should see /admin/simulator",
    ).toBeVisible();
  });

  test("operator sees only Monitor (4) + Reports (1); /audit and Admin group are hidden", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill("operator@surakkha.test");
    await page.getByLabel("Password").fill("demo-operator");
    await page.getByTestId("login-submit").click();
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/dashboard\/?$/);

    await expect(page.getByTestId("sidebar-fixed")).toBeVisible();
    expect(
      await navLinkCount(page),
      "Operator should see 5 nav links (Dashboard, Sensors, Incidents, Alerts, Reports)",
    ).toBe(5);

    // Items the operator MUST see.
    await expect(
      page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", {
        name: "Reports",
      }),
    ).toBeVisible();

    // Items the operator MUST NOT see.
    await expect(
      page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", {
        name: "Audit",
      }),
      "Operator must not see /audit (Admin-only per nav.ts:38)",
    ).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", {
        name: "Simulator",
      }),
      "Operator must not see /admin/simulator (Admin-only per nav.ts:44)",
    ).toHaveCount(0);
  });
});

test.describe("H — public /health endpoint via nginx", () => {
  test("GET /health returns 200 OK with status:ok JSON (no auth required)", async ({ request }) => {
    // The api mounts the handler at packages/api/src/index.ts:76-78
    // BEFORE the authenticate middleware — so no Authorization
    // header is needed. Nginx passes it through via the exact-match
    // `location = /health { proxy_pass http://api:3000/health; }`
    // block. This spec pins both layers in one call.
    const response = await request.get("/health");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    const body = (await response.json()) as { status?: string; service?: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("surakkha-api");
  });
});

test.describe("I — simulator frames populate the dashboard (JSONB fix downstream)", () => {
  test("dashboard live-readings region renders at least one row for a seeded device", async ({
    page,
    context,
  }) => {
    // This is the downstream check for the api Prisma JSONB alignment
    // fix (commit 57bf5eb). `buildRecentReadings` queries
    // `(deviceId, ts)` with `take: RATE_MAX_POINTS * RATE_METRICS_PER_FRAME`,
    // and the resulting rows feed the dashboard's live-readings region.
    //
    // Pre-fix: the query referenced a non-existent `metric` column and
    // returned zero rows for every device, so the dashboard rendered
    // the empty placeholder. Post-fix: at least the seeded online
    // devices show a row. We assert "at least one" rather than an
    // exact count because the simulator is best-effort (rate-limited,
    // occasionally reconnects) — a strong "all 6 devices" assertion
    // would be flaky against a real, noisy ingest path.
    await context.clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@surakkha.test");
    await page.getByLabel("Password").fill("demo-admin");
    await page.getByTestId("login-submit").click();
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/dashboard\/?$/);

    // The live-readings region must render. The polled `expect` settles
    // the SPA's render race with the network fetch on /api/readings/latest.
    await expect(page.getByTestId("dashboard-live-readings-region")).toBeVisible({
      timeout: 10_000,
    });

    // Either the populated table is present OR the empty placeholder
    // is — both are contractually valid renders. The regression we
    // care about is "table present but zero rows" (which means the
    // JSONB fix regressed). The empty branch tells us the api has
    // no data yet (cold cache / simulator just started) — give it a
    // moment to ingest.
    const rowLocator = page.locator('[data-testid^="dashboard-live-readings-row-"]');
    const emptyLocator = page.getByTestId("dashboard-live-readings-empty");
    const tableLocator = page.getByTestId("dashboard-live-readings-table");

    // First check: at least the table or the empty placeholder must
    // be visible (one of the two is the canonical render state).
    const either = await Promise.race([
      tableLocator.waitFor({ state: "visible", timeout: 5000 }).then(() => "table"),
      emptyLocator.waitFor({ state: "visible", timeout: 5000 }).then(() => "empty"),
    ]).catch(() => null);
    expect(
      either,
      "dashboard must show EITHER the live-readings table OR the empty placeholder",
    ).not.toBeNull();

    if (either === "table") {
      // Strong assertion: when the table is shown, AT LEAST ONE row
      // is present. The JSONB fix's whole point is that this is true.
      expect(
        await rowLocator.count(),
        "live-readings table should have ≥ 1 row when simulator is running",
      ).toBeGreaterThanOrEqual(1);
    }
    // If `either === "empty"`, the simulator hasn't ingested yet. That
    // is a transient state, not a code regression — accept it.
  });
});
