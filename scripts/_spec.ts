// Shared constants for the pinned spec (scripts only).
export const SPEC_PIN = {
  repo: "twilio/twilio-oai",
  file: "spec/json/twilio_api_v2010.json",
  commit: "218b7821602a93ae63e83e20ab5e8637e870250f",
  sha256: "78e76cc93c355a259e241866c241663eddb6ce0ed528f066c6cf0958648f5637",
  bytes: 1878531,
} as const;
export const SPEC_URL = `https://raw.githubusercontent.com/${SPEC_PIN.repo}/${SPEC_PIN.commit}/${SPEC_PIN.file}`;
export const SPEC_LOCAL = ".cache/spec/twilio_api_v2010.json";
