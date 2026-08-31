/**
 * LoginShell — Surakkha web (Story 1.3).
 *
 * Behavioural contract: epics.md §Story 1.3 (PRD F-5, UX-DR-4).
 * Visual contract: DESIGN.md §Layout & Spacing → "Login: split 1fr 1fr
 * at >= 1024px; below 1024px the hero panel is hidden and the form
 * takes the full width."
 *
 * Layout:
 *   - viewport >= 1024px (lg): split 1fr 1fr. Left = primary-gradient
 *     hero with the brand mark + tagline. Right = white form surface
 *     with email + password FormFields and a "Sign in" button.
 *   - viewport < 1024px: hero hidden, form takes the full viewport
 *     width with px-6 / px-4 / px-3 canvas padding per breakpoint.
 *
 * Submit contract:
 *   - The story says the shell posts to "the auth endpoint established
 *     in Story 1.4". That endpoint does not exist yet; for now the
 *     shell posts to a stub URL and surfaces a friendly "Sign-in is
 *     not available in this build" inline status. When Story 1.4
 *     lands `POST /auth/login`, the stub URL is swapped for the real
 *     one and the same handler drives the redirect to `/dashboard`.
 *
 * Copy discipline (Story 1.3 AC + DESIGN.md voice): every visible
 * string is checked for exclamation marks and marketing language.
 */
import { type FormEvent, useEffect, useState } from "react";

import { FormField, FormTextInput } from "../forms/FormField";

const HERO_GRADIENT =
  "linear-gradient(135deg, #1E5BB8 0%, #0EA5E9 100%)"; /* color.primary_gradient */
const FORM_BG = "#FFFFFF"; /* color.neutral.surface */

type Breakpoint = "lg" | "md" | "sm";
const MEDIA_LG = "(min-width: 1024px)";
const MEDIA_MD = "(min-width: 768px)";

const detectBreakpoint = (): Breakpoint => {
  if (typeof window === "undefined") return "lg";
  if (window.matchMedia(MEDIA_LG).matches) return "lg";
  if (window.matchMedia(MEDIA_MD).matches) return "md";
  return "sm";
};

const CANVAS_PADDING: Record<Breakpoint, string> = {
  lg: "px-6",
  md: "px-4",
  sm: "px-3",
};

interface LoginShellProps {
  readonly onSubmit: (email: string, password: string) => Promise<void>;
}

export const LoginShell = ({ onSubmit }: LoginShellProps) => {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>("lg");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setBreakpoint(detectBreakpoint());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;

    const trimmed = email.trim();
    if (trimmed.length === 0) {
      setEmailError("Enter your email address.");
      return;
    }
    if (password.length === 0) {
      // Password is required; we route this through FormField by reusing
      // the submitError slot rather than a per-field error so the form
      // only shows one inline message at a time.
      setSubmitError("Enter your password to continue.");
      return;
    }
    setEmailError(null);
    setSubmitError(null);
    setSubmitting(true);
    try {
      await onSubmit(trimmed, password);
    } catch (err) {
      // Story 1.3 only requires the in-flight label; the stub
      // surfaces a friendly inline status. Story 1.4 wires the real
      // error shape (401 / 403 / 5xx).
      setSubmitError(
        err instanceof Error ? err.message : "Sign-in is not available in this build.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="login-shell" className="flex min-h-screen flex-col lg:flex-row">
      {/* Hero panel — hidden below 1024px. */}
      <aside
        data-testid="login-hero"
        aria-label="Surakkha"
        className="hidden flex-col justify-between p-12 text-white lg:flex lg:w-1/2"
        style={{ backgroundImage: HERO_GRADIENT }}
      >
        <div
          aria-hidden
          data-testid="login-hero-brand"
          className="flex h-10 w-10 items-center justify-center rounded-input bg-white/15 text-lg font-bold"
        >
          S
        </div>
        <div className="space-y-3">
          <p className="text-2xl font-semibold leading-tight">
            Real-time water-safety monitoring for primary schools.
          </p>
          <p className="max-w-md text-md leading-relaxed text-white/85">
            Track sensor readings, triage incidents, and assign field technicians from one calm,
            role-aware surface.
          </p>
        </div>
        <p className="text-md text-white/70">Surakkha</p>
      </aside>

      {/* Form panel — full width below 1024px, right half above. */}
      <main
        data-testid="login-form-panel"
        className={[
          "flex flex-1 items-center justify-center bg-neutral-surface",
          CANVAS_PADDING[breakpoint],
          "py-12",
        ].join(" ")}
        style={{ backgroundColor: FORM_BG }}
      >
        <form
          data-testid="login-form"
          onSubmit={handleSubmit}
          noValidate
          className="w-full max-w-sm space-y-5"
        >
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold text-neutral-body">Sign in</h1>
            <p className="text-md text-neutral-secondary">Use your work email and password.</p>
          </header>

          <FormField label="Email" isRequired error={emailError ?? undefined}>
            {(controlProps) => (
              <FormTextInput
                {...controlProps}
                type="email"
                autoComplete="username"
                placeholder="you@school.edu.bd"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError !== null) setEmailError(null);
                }}
              />
            )}
          </FormField>

          <FormField label="Password" isRequired>
            {(controlProps) => (
              <FormTextInput
                {...controlProps}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (submitError !== null) setSubmitError(null);
                }}
              />
            )}
          </FormField>

          {submitError === null ? null : (
            <p
              data-testid="login-submit-error"
              role="alert"
              className="text-md text-severity-critical-text"
            >
              {submitError}
            </p>
          )}

          <button
            type="submit"
            data-testid="login-submit"
            disabled={submitting}
            className="h-10 w-full rounded-input bg-primary px-4 text-md font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-primary/60"
          >
            {submitting ? "Signing in\u2026" : "Sign in"}
          </button>
        </form>
      </main>
    </div>
  );
};
