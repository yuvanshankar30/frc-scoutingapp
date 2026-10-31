// How old a signed-in token is, from its "issued at" time. The token's signature is checked
// by Supabase; this only reads the claim, to refuse a token that was not issued just now.
export function tokenAgeSeconds(token, nowMs = Date.now()) {
  try {
    const payload = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const issued = JSON.parse(atob(payload)).iat;
    return Number.isFinite(issued) ? Math.max(0, Math.floor(nowMs / 1000) - issued) : Infinity;
  } catch {
    return Infinity;
  }
}
