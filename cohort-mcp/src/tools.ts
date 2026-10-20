import { z } from "zod";

/**
 * Phase 1 tool input schemas. Keeping them here means the handlers in server.ts
 * stay a thin wiring layer over the load, propose, status, and policy modules.
 */

/** cohort_load: bounded, fenced context from the vault. */
export const loadInput = {
  topics: z
    .array(z.string())
    .optional()
    .describe("Optional topic filters to narrow the loaded context."),
  scope: z
    .string()
    .optional()
    .describe("Optional scope hint, reserved for future use."),
};

/** A single proposed record. The server stamps provenance; the model supplies only kind, text, and an optional class hint. */
const recordItem = z.object({
  kind: z.enum(["fact", "decision", "thread"]),
  text: z.string().min(1).describe("The record body."),
  class: z
    .string()
    .optional()
    .describe("Optional policy class hint (for example coding-convention). A hint only; the gate decides."),
});

/** cohort_propose: records to run through the write gate. */
export const proposeInput = {
  items: z
    .array(recordItem)
    .min(1)
    .describe("Records to run through the write gate."),
};

/** cohort_status and cohort_policy_get take no input. */
export const statusInput = {};
export const policyGetInput = {};

/** cohort_search: text lookup across the vault. */
export const searchInput = {
  query: z.string().min(1).describe("Text to search for across the vault."),
  include_quarantined: z
    .boolean()
    .optional()
    .describe("Include agent-asserted, unverified records. Default: verified only."),
};
