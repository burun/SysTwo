import { randomBytes } from "node:crypto";

export function createTraceId(prefix = "trace"): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${prefix}-${timestamp}-${randomBytes(4).toString("hex")}`;
}
