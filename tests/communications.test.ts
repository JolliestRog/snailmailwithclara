import { describe, expect, it } from "vitest";
import {
  canPublishAnnouncement,
  welcomeMessageFor,
} from "../src/worker/communications";

describe("announcement permissions", () => {
  it("lets curators publish newsletters but not safety warnings", () => {
    expect(canPublishAnnouncement(["member", "curator"], "newsletter")).toBe(
      true,
    );
    expect(canPublishAnnouncement(["member", "curator"], "warning")).toBe(
      false,
    );
  });

  it("lets moderators publish updates but not newsletters", () => {
    expect(canPublishAnnouncement(["member", "moderator"], "update")).toBe(
      true,
    );
    expect(canPublishAnnouncement(["member", "moderator"], "newsletter")).toBe(
      false,
    );
  });

  it("lets security administrators publish every kind", () => {
    expect(canPublishAnnouncement(["security_admin"], "newsletter")).toBe(true);
    expect(canPublishAnnouncement(["security_admin"], "warning")).toBe(true);
  });
});

describe("approval welcome messages", () => {
  it("explains the vault, recovery, and consent to every member", () => {
    const welcome = welcomeMessageFor(["member"]);
    expect(welcome.body).toContain("Address vault");
    expect(welcome.body).toContain("recovery code");
    expect(welcome.body).toContain("Nothing shares your address");
  });

  it("adds role-specific instructions", () => {
    const welcome = welcomeMessageFor(["member", "moderator", "curator"]);
    expect(welcome.body).toContain("Moderator tools");
    expect(welcome.body).toContain("Curator tools");
    expect(welcome.body).toContain("Clara's page");
  });
});
