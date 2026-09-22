import { useEffect, useState } from "react";
import type {
  CurrentUser,
  PostalAddress,
  VaultRecord,
} from "../../shared/types";
import { api, jsonBody } from "../api";
import { decryptAddress, encryptAddress } from "../crypto";
import { VaultLocked } from "./Dashboard";

const emptyAddress: PostalAddress = {
  recipient: "",
  organization: "",
  addressLine1: "",
  addressLine2: "",
  locality: "",
  region: "",
  postalCode: "",
  countryCode: "US",
};

export function VaultPage({
  user,
  masterKey,
  unlock,
  unlockError,
  refreshUser,
}: {
  user: CurrentUser;
  masterKey: Uint8Array | null;
  unlock: (code: string) => Promise<void>;
  unlockError: string;
  refreshUser: () => Promise<void>;
}) {
  const [address, setAddress] = useState<PostalAddress>(emptyAddress);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!masterKey) return;
    api<{ vault: VaultRecord }>("/api/vault")
      .then(async ({ vault }) => {
        if (vault.encryptedAddress)
          setAddress(await decryptAddress(masterKey, vault.encryptedAddress));
      })
      .catch((caught) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not open the vault.",
        ),
      );
  }, [masterKey]);
  if (!masterKey)
    return (
      <>
        <PageTitle kicker="Private by design" title="Address vault" />
        <VaultLocked unlock={unlock} error={unlockError} />
      </>
    );
  const unlockedMasterKey = masterKey;
  function field(name: keyof PostalAddress, value: string) {
    setAddress((current) => ({ ...current, [name]: value }));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      const encryptedAddress = await encryptAddress(unlockedMasterKey, {
        ...address,
        countryCode: address.countryCode.toUpperCase(),
      });
      await api("/api/vault", {
        method: "PUT",
        ...jsonBody({
          encryptedAddress,
          countryCode: address.countryCode.toUpperCase(),
        }),
      });
      setNotice("Address encrypted and saved.");
      await refreshUser();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save the address.",
      );
    }
  }
  return (
    <>
      <PageTitle kicker="Encrypted on this device" title="Address vault" />
      <div className="notice privacy-note">
        <strong>The server never receives these fields.</strong>
        <span>
          Your browser encrypts the complete label before upload. Only the
          country code is stored separately for matching.
        </span>
      </div>
      <form className="panel address-form" onSubmit={save}>
        <div className="form-grid">
          <label>
            Recipient name
            <input
              value={address.recipient}
              onChange={(e) => field("recipient", e.target.value)}
              required
            />
          </label>
          <label>
            Organization <small>optional</small>
            <input
              value={address.organization}
              onChange={(e) => field("organization", e.target.value)}
            />
          </label>
          <label className="wide">
            Address line 1
            <input
              value={address.addressLine1}
              onChange={(e) => field("addressLine1", e.target.value)}
              required
            />
          </label>
          <label className="wide">
            Address line 2 <small>optional</small>
            <input
              value={address.addressLine2}
              onChange={(e) => field("addressLine2", e.target.value)}
            />
          </label>
          <label>
            City / locality
            <input
              value={address.locality}
              onChange={(e) => field("locality", e.target.value)}
              required
            />
          </label>
          <label>
            State / region
            <input
              value={address.region}
              onChange={(e) => field("region", e.target.value)}
            />
          </label>
          <label>
            Postal code
            <input
              value={address.postalCode}
              onChange={(e) => field("postalCode", e.target.value)}
            />
          </label>
          <label>
            Country code
            <input
              value={address.countryCode}
              onChange={(e) =>
                field("countryCode", e.target.value.toUpperCase())
              }
              pattern="[A-Z]{2}"
              maxLength={2}
              required
            />
          </label>
        </div>
        {notice && (
          <p className="success" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button>Encrypt and save address</button>
      </form>
    </>
  );
}

export function PageTitle({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-title">
      <div>
        <p className="kicker">{kicker}</p>
        <h1>{title}</h1>
      </div>
      {children}
    </header>
  );
}
