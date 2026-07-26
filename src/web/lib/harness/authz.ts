/**
 * Authorization gate for /api/harness/* routes.
 *
 * HAR-54 adds a superadmin user type and a real check derived from the
 * Player Accounts & Auth project's Auth.js sessions. Until that lands,
 * every caller is denied - these routes expose token spend and internal
 * session titles, so failing open even briefly is not acceptable.
 *
 * Replace the body of this function (only) when HAR-54 ships; the routes
 * that call it do not need to change.
 */
export function isHarnessSuperadmin(_request: Request): boolean {
  return false;
}
