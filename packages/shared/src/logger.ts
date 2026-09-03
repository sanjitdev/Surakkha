/**
 * Shared pino logger factory. Api and simulator import from here so
 * log formatting is consistent across processes.
 */
import pino, { type Logger } from "pino";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LoggerOptions {
  readonly name: string;
  readonly level?: LogLevel;
  readonly pretty?: boolean;
}

export function createLogger(options: LoggerOptions): Logger {
  const level: LogLevel = options.level ?? "info";
  const transport = options.pretty
    ? { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss" } }
    : undefined;
  return pino({
    name: options.name,
    level,
    ...(transport !== undefined ? { transport } : {}),
  });
}
