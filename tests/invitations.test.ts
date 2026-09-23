import { describe, expect, it } from "vitest";
import { invitationRolesFor } from "../src/worker/moderation";

describe("invitation roles", () => {
  it("keeps ordinary invitations member-only", () => {
    expect(invitationRolesFor(["member"], false)).toEqual(["member"]);
  });

  it("allows security administrators to create Clara's role bundle", () => {
    expect(invitationRolesFor(["curator", "moderator"], true)).toEqual([
      "member",
      "curator",
      "moderator",
    ]);
  });

  it("prevents moderators from granting privileged roles", () => {
    expect(() => invitationRolesFor(["moderator"], false)).toThrow(
      "Only the security administrator",
    );
  });

  it("never accepts security administrator invitations", () => {
    expect(() => invitationRolesFor(["security_admin"], true)).toThrow(
      "Invitation roles may include",
    );
  });
});
