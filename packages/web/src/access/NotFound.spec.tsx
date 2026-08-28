/**
 * `NotFound.spec.tsx` — Story 4.4 step-04 review.
 *
 * Dedicated unit test for the first 404 surface in the web
 * codebase. Pins the component's contract — defaults, override
 * props, back-link target, and accessibility attributes — so a
 * regression here is caught at the source rather than at every
 * consumer (the detail page today, future per-entity detail pages
 * in Stories 4.5 / 4.6 / 4.7 / 4.11).
 *
 * Coverage:
 *   - renders <main> with role=status and aria-live=polite
 *   - default headline / message / backHref / backLabel
 *   - override props are honored verbatim
 *   - back link is a real <a> with the expected href target
 */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { NotFound } from "./NotFound";

const renderNotFound = (props: Partial<React.ComponentProps<typeof NotFound>> = {}) =>
  render(
    <MemoryRouter initialEntries={["/incidents/missing"]}>
      <NotFound {...props} />
    </MemoryRouter>,
  );

describe("Story 4.4 — NotFound semantic contract", () => {
  afterEach(() => cleanup());

  it("renders <main> with role=status and aria-live=polite", () => {
    renderNotFound();
    const main = screen.getByTestId("not-found");
    expect(main.tagName).toBe("MAIN");
    expect(main.getAttribute("role")).toBe("status");
    expect(main.getAttribute("aria-live")).toBe("polite");
  });

  it("exposes default headline + message copy", () => {
    renderNotFound();
    expect(screen.getByRole("heading", { level: 1, name: "Not found" })).toBeInTheDocument();
    expect(screen.getByText("The item you requested could not be found.")).toBeInTheDocument();
  });

  it("links back to /incidents by default (the kanban index, not /)", () => {
    renderNotFound();
    const link = screen.getByTestId("not-found-back-link");
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/incidents");
    expect(link.textContent).toBe("Back to incidents");
  });

  it("respects custom headline / message / backHref / backLabel overrides", () => {
    renderNotFound({
      headline: "Device not found",
      message: "This device has been removed or never existed.",
      backHref: "/sensors",
      backLabel: "Back to sensors",
    });
    expect(screen.getByRole("heading", { level: 1, name: "Device not found" })).toBeInTheDocument();
    expect(screen.getByText("This device has been removed or never existed.")).toBeInTheDocument();
    const link = screen.getByTestId("not-found-back-link");
    expect(link.getAttribute("href")).toBe("/sensors");
    expect(link.textContent).toBe("Back to sensors");
  });
});
