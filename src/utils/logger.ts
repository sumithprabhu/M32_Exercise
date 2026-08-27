type LogFields = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", message: string, fields?: LogFields): void {
  const line = { timestamp: new Date().toISOString(), level, message, ...fields };
  const output = JSON.stringify(line);
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.log(output);
}

export const logger = {
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  error: (message: string, fields?: LogFields) => emit("error", message, fields),
};
