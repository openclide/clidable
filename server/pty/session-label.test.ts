import { describe, expect, it } from "bun:test";
import { getSessionLabel, setSessionLabel } from "./session-label";

describe("session label store", () => {
  it("stores and reads a user-given name", () => {
    expect(getSessionLabel("s-1")).toBeNull();
    setSessionLabel("s-1", "Backend API");
    expect(getSessionLabel("s-1")).toBe("Backend API");
    setSessionLabel("s-1", null);
    expect(getSessionLabel("s-1")).toBeNull();
  });

  it("trims, and treats blank/whitespace as a clear", () => {
    setSessionLabel("s-2", "  Docs  ");
    expect(getSessionLabel("s-2")).toBe("Docs");
    setSessionLabel("s-2", "   ");
    expect(getSessionLabel("s-2")).toBeNull();
  });
});
