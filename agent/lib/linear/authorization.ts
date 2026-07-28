/** The Linear user to attribute an auth prompt to. */
export const linearUserIdFromAuthContext = (
  auth: {
    readonly authenticator: string;
    readonly principalType: string;
    readonly subject?: string;
  } | null,
): string | undefined =>
  auth?.authenticator === "linear-agent-webhook" &&
  auth.principalType === "user" &&
  auth.subject !== undefined &&
  auth.subject.length > 0 &&
  auth.subject !== "unknown"
    ? auth.subject
    : undefined;
