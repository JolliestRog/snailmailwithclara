import { describe, expect, it } from "vitest";
import {
  safeExternalHref,
  validAddress,
  validLandingContent,
  validMailSettings,
  validUsername,
} from "../src/shared/validation";

describe("input validation", () => {
  it("accepts intentional usernames and rejects confusing forms", () => {
    expect(validUsername("clara_mail")).toBe(true);
    expect(validUsername("Clara")).toBe(false);
    expect(validUsername("../admin")).toBe(false);
  });

  it("requires only globally common address fields", () => {
    expect(
      validAddress({
        recipient: "A",
        addressLine1: "1 Road",
        locality: "London",
        countryCode: "GB",
      }),
    ).toBe(true);
    expect(
      validAddress({
        recipient: "A",
        addressLine1: "1 Road",
        locality: "London",
        countryCode: "United Kingdom",
      }),
    ).toBe(false);
  });

  it("constrains mail settings", () => {
    expect(
      validMailSettings({
        rouletteEnabled: true,
        anonymousEnabled: true,
        monthlyLimit: 4,
        destinationMode: "anywhere",
        destinationCountries: [],
        paused: false,
      }),
    ).toBe(true);
    expect(
      validMailSettings({
        rouletteEnabled: true,
        anonymousEnabled: true,
        monthlyLimit: 100,
        destinationMode: "anywhere",
        destinationCountries: [],
        paused: false,
      }),
    ).toBe(false);
  });

  it("never accepts script links or arbitrary block types", () => {
    expect(safeExternalHref("javascript:alert(1)")).toBeNull();
    expect(safeExternalHref("https://example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(
      validLandingContent({
        theme: "signal-red",
        blocks: [{ id: "bad", type: "embed", html: "<script />" }],
      }),
    ).toBe(false);
  });
});
