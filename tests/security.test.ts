import { describe, expect, it } from "vitest";
import { securityHeaders } from "../src/worker/security";

describe("response hardening", () => {
  it("sets a same-origin CSP and denies framing", () => {
    const response = securityHeaders(new Response("ok"));
    expect(response.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
