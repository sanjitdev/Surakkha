/**
 * FormField — Surakkha web (Stories 1.3 + Epic 4).
 *
 * Visual contract: EXPERIENCE.md §Components → `FormField`
 * (label above input, helper text below, error inline using
 * `color.severity.critical.text`).
 *
 * Copy discipline: the required-indicator is the literal text
 * "(required)" — no asterisks (EXPERIENCE.md §FormField / PRD F-5,
 * F-12, F-13). Strings rendered to the user never contain exclamation
 * marks or marketing language (Story 1.3 AC + DESIGN.md voice).
 *
 * The primitive is generic over the underlying input element so login,
 * incident forms, settings, and the simulator (Story 3.5) can share
 * the same critical-first visual rhythm.
 */
import { type InputHTMLAttributes, type ReactNode, useId } from "react";

interface FormFieldRenderProps {
  readonly id: string;
  readonly "aria-invalid": "true" | "false";
  readonly "aria-describedby": string | undefined;
}

interface FormFieldProps {
  readonly label: string;
  readonly helperText?: string;
  readonly error?: string;
  readonly isRequired?: boolean;
  readonly className?: string;
  readonly children: (controlProps: FormFieldRenderProps) => ReactNode;
}

const ERROR_COLOR = "#B42318"; /* severity.critical.text */

export const FormField = ({
  label,
  helperText,
  error,
  isRequired,
  className,
  children,
}: FormFieldProps) => {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const helperId = helperText === undefined ? undefined : `${baseId}-helper`;
  const errorId = error === undefined ? undefined : `${baseId}-error`;
  const describedBy =
    errorId !== undefined
      ? errorId
      : helperId !== undefined
      ? helperId
      : undefined;

  return (
    <div className={["flex flex-col gap-1.5", className ?? ""].join(" ")}>
      <label
        htmlFor={inputId}
        className="flex items-baseline gap-1 text-md font-medium text-neutral-body"
      >
        <span>{label}</span>
        {isRequired ? (
          <span className="text-md font-normal text-neutral-secondary">
            (required)
          </span>
        ) : null}
      </label>
      {children({
        id: inputId,
        "aria-invalid": error === undefined ? "false" : "true",
        "aria-describedby": describedBy,
      })}
      {/* eslint-disable react/forbid-dom-props -- the helper <p> and
          error <p> are deliberately the targets of aria-describedby; the
          rule's intent (avoid duplicate / colliding DOM ids) does not
          apply to unique useId-derived values. */}
      {error === undefined ? (
        helperText === undefined ? null : (
          <p id={helperId} className="text-md text-neutral-secondary">
            {helperText}
          </p>
        )
      ) : (
        <p
          id={errorId}
          role="alert"
          className="text-md"
          style={{ color: ERROR_COLOR }}
        >
          {error}
        </p>
      )}
      {/* eslint-enable react/forbid-dom-props */}
    </div>
  );
};

/**
 * Convenience wrapper that renders a `<input type="text"|"email"|"password"|
 * "search" ...>` with the FormField render-prop wiring applied. Other
 * primitives (select, textarea) use the render-prop API directly.
 */
export const FormTextInput = ({
  type,
  className,
  ...inputProps
}: {
  readonly type: "text" | "email" | "password" | "search" | "url";
  readonly className?: string;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "id" | "aria-invalid" | "aria-describedby"
>) => (
  <input
    {...inputProps}
    type={type}
    className={[
      "h-10 w-full rounded-input border border-neutral-border bg-neutral-surface px-3 text-md text-neutral-body outline-none transition-shadow focus:ring-2 focus:ring-primary",
      className ?? "",
    ].join(" ")}
  />
);