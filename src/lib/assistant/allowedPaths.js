// The only endpoints a confirmed assistant proposal may call. Shared by the server (which builds proposals) and
// the browser (which refuses to send anything else), so the two cannot drift apart.
export const ALLOWED_PATHS = Object.freeze(['/api/scouting-picklist', '/notescout']);

/** In a later request's body, this exact value means "the id returned by the request before it". Nothing else is substituted. */
export const PREV_ID = '$prev.data.id';

/** The body of a request with PREV_ID replaced by the previous response's data.id (or null when there is none). */
export function fillBody(body, previousResponse) {
  const id = previousResponse?.data?.id ?? null;
  return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === PREV_ID ? id : v]));
}

/** True when every request in a proposal is a POST to an allowed path with a plain-object body. */
export function proposalIsSendable(proposal) {
  const requests = proposal?.requests;
  return (
    Array.isArray(requests) &&
    requests.length > 0 &&
    requests.length <= 12 &&
    requests.every(
      (r) =>
        r &&
        r.method === 'POST' &&
        ALLOWED_PATHS.includes(r.path) &&
        r.body &&
        typeof r.body === 'object' &&
        !Array.isArray(r.body)
    )
  );
}
