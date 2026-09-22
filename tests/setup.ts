import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";

Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});
if (!globalThis.btoa)
  globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64");
if (!globalThis.atob)
  globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");
