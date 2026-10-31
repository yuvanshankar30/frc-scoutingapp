// Strips tokens and keys out of error text before it is saved or shown, so a failing integration cannot leak a
// credential into the database or the UI.
export function redactSecretText(value) {
  return String(value ?? '')
    .replace(/(\bhttps?:\/\/[^\s"'<>?|]+)\?[^\s"'<>|]+/gi, '$1?<redacted>')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '<redacted-jwt>')
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '<redacted-key>')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '<redacted-key>')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '<redacted-key>')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, 'Bearer <redacted>');
}
