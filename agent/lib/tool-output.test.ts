import { describe, expect, it } from "vitest";

import { flagField, scalarField, textField } from "./tool-output";

describe("reading a framework tool's output", () => {
  const output = { exitCode: 0, stdout: "hello", truncated: true };

  it("reads the fields a well-shaped output carries", () => {
    expect(textField(output, "stdout")).toBe("hello");
    expect(scalarField(output, "exitCode")).toBe("0");
    expect(flagField(output, "truncated")).toBe(true);
  });

  // The point of the module: eve retyping or renaming a field must not throw
  // inside every tool call, so each reader has a usable fallback.
  it("degrades instead of throwing when a field is missing or retyped", () => {
    expect(textField({ stdout: 42 }, "stdout")).toBe("");
    expect(textField({}, "stdout")).toBe("");
    expect(scalarField({}, "exitCode")).toBe("unknown");
    expect(scalarField({ exitCode: null }, "exitCode")).toBe("unknown");
    expect(flagField({}, "truncated")).toBe(false);
    expect(flagField({ truncated: "yes" }, "truncated")).toBe(false);
  });

  it("degrades on an output that is not an object at all", () => {
    for (const value of [null, undefined, "text", 7, []]) {
      expect(textField(value, "stdout")).toBe("");
      expect(scalarField(value, "exitCode")).toBe("unknown");
      expect(flagField(value, "truncated")).toBe(false);
    }
  });
});
