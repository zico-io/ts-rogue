import { describe, expect, it } from "vitest";
import { isHarnessSuperadmin } from "./authz";

describe("isHarnessSuperadmin", () => {
  it("denies every caller until HAR-54 lands a real check", () => {
    expect(
      isHarnessSuperadmin(
        new Request("https://example.test/api/harness/sessions"),
      ),
    ).toBe(false);
    expect(
      isHarnessSuperadmin(
        new Request("https://example.test/api/harness/sessions", {
          headers: { authorization: "Bearer anything" },
        }),
      ),
    ).toBe(false);
  });
});
