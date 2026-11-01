import { expect, test } from "vitest";
import { privacyCaseReturnPath } from "./requestPath";

const CASE_ID = "a3c8f25e-2b78-4c12-92f7-79c97b7ed913";
const PATH = `/settings/privacy/requests/${CASE_ID}`;

test.each([PATH, `/settings/privacy/requests/${CASE_ID.toUpperCase()}`])(
  "retains only an exact opaque case path: %s",
  (path) => {
    expect(privacyCaseReturnPath(path)).toBe(path);
  },
);

test.each([
  null,
  undefined,
  "",
  "/",
  "/pipeline",
  "/settings/privacy",
  `${PATH}/`,
  `${PATH}/extra`,
  `${PATH}?summary=PRIVATE-query`,
  `${PATH}#PRIVATE-fragment`,
  `https://app.example.test${PATH}`,
  `//evil.example.test${PATH}`,
  `\\${PATH}`,
  "/settings/privacy/requests/not-an-id",
  "/settings/privacy/requests/..%2fPRIVATE",
  `${PATH}\n`,
  7,
  { path: PATH },
  [PATH],
  "PRIVATE".repeat(1000),
])("rejects non-case, malformed or sensitive return-path input %#", (input) => {
  expect(privacyCaseReturnPath(input)).toBeNull();
});
