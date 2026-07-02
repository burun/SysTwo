const SECRET_PATTERNS: RegExp[] = [
  /\b[A-Za-z0-9_]*API[_-]?KEY[A-Za-z0-9_]*\s*[:=]\s*["']?[^"'\s]+["']?/gi,
  /\b[A-Za-z0-9_]*TOKEN[A-Za-z0-9_]*\s*[:=]\s*["']?[^"'\s]+["']?/gi,
  /\b[A-Za-z0-9_]*SECRET[A-Za-z0-9_]*\s*[:=]\s*["']?[^"'\s]+["']?/gi,
  /\bsk-[A-Za-z0-9]{16,}\b/g
];

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((current, pattern) => current.replace(pattern, "[REDACTED_SECRET]"), value);
}
