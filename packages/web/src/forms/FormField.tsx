/**
 * FormField — label-above-input primitive. Renders an error in
 * `text-severity-critical-text` when present, otherwise helper text.
 * The required indicator is the literal "(required)" (no asterisks).
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
    errorId !== undefined ? errorId : helperId !== undefined ? helperId : undefined;

  return (
    <div className={["flex flex-col gap-1.5", className ?? ""].join(" ")}>
      <label
        htmlFor={inputId}
        className="flex items-baseline gap-1 text-md font-medium text-neutral-body"
      >
        <span>{label}</span>
        {isRequired ? (
          <span className="text-md font-normal text-neutral-secondary">(required)</span>
        ) : null}
      </label>
      {children({
        id: inputId,
        "aria-invalid": error === undefined ? "false" : "true",
        "aria-describedby": describedBy,
      })}
      {/* eslint-disable react/forbid-dom-props -- useId-derived ids can't collide. */}
      {error === undefined ? (
        helperText === undefined ? null : (
          <p id={helperId} className="text-md text-neutral-secondary">
            {helperText}
          </p>
        )
      ) : (
        <p id={errorId} role="alert" className="text-md text-severity-critical-text">
          {error}
        </p>
      )}
      {/* eslint-enable react/forbid-dom-props */}
    </div>
  );
};

/** Convenience wrapper for plain text inputs; other primitives use
 *  the render-prop API directly. */
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
