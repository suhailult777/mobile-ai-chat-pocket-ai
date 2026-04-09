export const OPENCLAW_RUN_COMMAND_ALLOWLIST = [
  /^whoami(\s|$)/i,
  /^hostname(\s|$)/i,
  /^pwd(\s|$)/i,
  /^Get-Location(\s|$)/i,
  /^ls(\s|$)/i,
  /^dir(\s|$)/i,
  /^Get-ChildItem(\s|$)/i,
  /^cat(\s|$)/i,
  /^type(\s|$)/i,
  /^Get-Content(\s|$)/i,
  /^echo(\s|$)/i,
  /^ipconfig(\s|$)/i,
  /^ifconfig(\s|$)/i,
  /^netstat(\s|$)/i,
  /^tasklist(\s|$)/i,
  /^Get-Process(\s|$)/i,
  /^git\s+(status|branch|log|diff|show|rev-parse)(\s|$)/i,
];

export const OPENCLAW_BLOCKED_COMMAND_TOKENS = /[;&|><`$\n\r]/;

export function isDangerousOpenClawCommand(command) {
  const text = String(command || "").trim();
  if (!text) return true;
  if (OPENCLAW_BLOCKED_COMMAND_TOKENS.test(text)) return true;
  const normalized = text.replace(/\s+/g, " ");
  return !OPENCLAW_RUN_COMMAND_ALLOWLIST.some((pattern) => pattern.test(normalized));
}

export function createOpenClawIdempotencyKey(
  tool,
  args,
  windowMs = 5000,
  now = Date.now(),
) {
  const signature = JSON.stringify(args || {});
  const bucket = Math.floor(now / windowMs);
  return `${tool}:${signature}:${bucket}`;
}
