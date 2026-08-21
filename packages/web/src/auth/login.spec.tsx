/**
 * Story 1.3 — Login Shell.
 *
 * Coverage matrix (each AC pinned by at least one assertion):
 *
 *   - viewport >= 1024px: split-screen; hero present, form present
 *   - viewport <  1024px: hero hidden (lg:flex class but element hidden via
 *     `hidden` class), form panel takes full width
 *   - 24/16/12 canvas padding tiers per breakpoint
 *   - "Signing in…" label appears while submit is in flight
 *   - copy discipline: no exclamation marks in any rendered string
 *   - email + password required validation
 *   - happy path: stub submit resolves without throwing
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LoginShell } from "./LoginShell";

const setViewport = (width: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  window.matchMedia = (query: string) => {
    const matches =
      (query.includes("min-width: 1024") && width >= 1024) ||
      (query.includes("min-width: 768") && width >= 768);
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  };
};

const NOOP_SUBMIT = async (_email: string, _password: string): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const renderLogin = (onSubmit = NOOP_SUBMIT) =>
  render(<LoginShell onSubmit={onSubmit} />);

describe("Story 1.3 — split-screen at viewport >= 1024px", () => {
  beforeEach(() => setViewport(1280));
  afterEach(() => cleanup());

  it("renders the hero panel and form panel side-by-side", () => {
    renderLogin();
    const hero = screen.getByTestId("login-hero");
    const form = screen.getByTestId("login-form-panel");
    expect(hero).toBeInTheDocument();
    expect(form).toBeInTheDocument();
    // Tailwind `lg:flex` brings the hero into flex flow at >=1024px.
    expect(hero.className).toContain("lg:flex");
    expect(hero.className).toContain("hidden");
  });

  it("hero carries the primary gradient and brand mark", () => {
    renderLogin();
    const hero = screen.getByTestId("login-hero");
    expect(hero.style.backgroundImage).toBe(
      "linear-gradient(135deg, #1E5BB8 0%, #0EA5E9 100%)",
    );
    expect(screen.getByTestId("login-hero-brand")).toBeInTheDocument();
  });

  it("form panel applies px-6 (24px) at >=1024px", () => {
    renderLogin();
    expect(screen.getByTestId("login-form-panel").className).toContain("px-6");
  });
});

describe("Story 1.3 — hero hidden below 1024px", () => {
  beforeEach(() => setViewport(900));
  afterEach(() => cleanup());

  it("hides the hero at <1024px (hidden lg:flex)", () => {
    renderLogin();
    const hero = screen.getByTestId("login-hero");
    expect(hero.className).toContain("hidden");
  });

  it("form panel applies px-4 (16px) at 768-1023px", () => {
    renderLogin();
    expect(screen.getByTestId("login-form-panel").className).toContain("px-4");
  });
});

describe("Story 1.3 — form panel at <768px", () => {
  beforeEach(() => setViewport(420));
  afterEach(() => cleanup());

  it("applies px-3 (12px) below 768px", () => {
    renderLogin();
    expect(screen.getByTestId("login-form-panel").className).toContain("px-3");
  });
});

describe("Story 1.3 — submit states", () => {
  beforeEach(() => setViewport(1280));
  afterEach(() => cleanup());

  it("shows the static 'Sign in' label before submit", () => {
    renderLogin();
    const button = screen.getByTestId("login-submit");
    expect(button.textContent).toBe("Sign in");
    expect(button).not.toBeDisabled();
  });

  it("disables the button and shows 'Signing in…' while in flight", async () => {
    const user = userEvent.setup();
    // A submit handler that resolves only after we re-check the label.
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = async (_email: string, _password: string): Promise<void> => {
      await slow;
    };

    renderLogin(handler);
    await user.type(screen.getByLabelText(/Email/), "rahim@school.edu.bd");
    await user.type(screen.getByLabelText(/Password/), "secret123");
    await user.click(screen.getByTestId("login-submit"));

    const button = screen.getByTestId("login-submit");
    expect(button.textContent).toBe("Signing in\u2026");
    expect(button).toBeDisabled();

    release();
    // Let the handler resolve + finally block run.
    await slow;
  });

  it("rejects an empty email with an inline error", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText(/Password/), "secret123");
    await user.click(screen.getByTestId("login-submit"));

    // Email FormField shows the error in its slot (rendered via FormField).
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.some((el) => /Enter your email/i.test(el.textContent ?? ""))).toBe(
      true,
    );
  });

  it("happy path resolves without showing an error", async () => {
    const user = userEvent.setup();
    const submitted: Array<{ email: string; password: string }> = [];
    const handler = async (email: string, password: string): Promise<void> => {
      submitted.push({ email, password });
    };
    renderLogin(handler);

    await user.type(screen.getByLabelText(/Email/), "  rahim@school.edu.bd  ");
    await user.type(screen.getByLabelText(/Password/), "secret123");
    await user.click(screen.getByTestId("login-submit"));

    expect(submitted).toEqual([
      { email: "rahim@school.edu.bd", password: "secret123" },
    ]);
    expect(screen.queryByTestId("login-submit-error")).not.toBeInTheDocument();
  });

  it("surfaces a server-style error when the handler throws", async () => {
    const user = userEvent.setup();
    const handler = async (): Promise<void> => {
      throw new Error("Network unreachable.");
    };
    renderLogin(handler);

    await user.type(screen.getByLabelText(/Email/), "rahim@school.edu.bd");
    await user.type(screen.getByLabelText(/Password/), "secret123");
    await user.click(screen.getByTestId("login-submit"));

    expect(await screen.findByTestId("login-submit-error")).toHaveTextContent(
      "Network unreachable.",
    );
  });
});

describe("Story 1.3 — copy discipline (no exclamation marks)", () => {
  beforeEach(() => setViewport(1280));
  afterEach(() => cleanup());

  it("no rendered string contains an exclamation mark", () => {
    const { container } = renderLogin();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const offenders: string[] = [];
    let node: Node | null = walker.nextNode();
    while (node !== null) {
      const text = node.textContent ?? "";
      if (text.includes("!")) {
        offenders.push(text);
      }
      node = walker.nextNode();
    }
    expect(offenders).toEqual([]);
  });
});