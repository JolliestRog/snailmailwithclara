import { describe, expect, it } from "vitest";
import type { PostalAddress } from "../src/shared/types";
import {
  decryptAddress,
  encryptAddress,
  initializeVault,
  openSealed,
  sealJson,
} from "../src/client/crypto";

describe("zero-knowledge address envelopes", () => {
  it("round trips an international address without exposing fields in ciphertext", async () => {
    const vault = await initializeVault();
    const address: PostalAddress = {
      recipient: "Clara Example",
      addressLine1: "123 Secret Lane",
      locality: "Chicago",
      region: "IL",
      postalCode: "60601",
      countryCode: "US",
    };
    const encrypted = await encryptAddress(vault.masterKey, address);
    expect(JSON.stringify(encrypted)).not.toContain(address.recipient);
    expect(JSON.stringify(encrypted)).not.toContain(address.addressLine1);
    await expect(decryptAddress(vault.masterKey, encrypted)).resolves.toEqual(
      address,
    );
  });

  it("seals a grant to exactly one member encryption identity", async () => {
    const recipient = await initializeVault();
    const other = await initializeVault();
    const sealed = await sealJson(recipient.publicEncryptionKey, {
      recipient: "Private Person",
      countryCode: "CA",
    });
    await expect(
      openSealed(recipient.masterKey, recipient.encryptedPrivateKey, sealed),
    ).resolves.toEqual({
      recipient: "Private Person",
      countryCode: "CA",
    });
    await expect(
      openSealed(other.masterKey, other.encryptedPrivateKey, sealed),
    ).rejects.toThrow();
  });

  it("detects ciphertext tampering", async () => {
    const vault = await initializeVault();
    const encrypted = await encryptAddress(vault.masterKey, {
      recipient: "A",
      addressLine1: "B",
      locality: "C",
      countryCode: "GB",
    });
    encrypted.ciphertext = `A${encrypted.ciphertext.slice(1)}`;
    await expect(decryptAddress(vault.masterKey, encrypted)).rejects.toThrow();
  });
});
