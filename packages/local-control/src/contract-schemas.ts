import { z } from "zod";

export const identifierSchema = z.string().min(1).max(200);
export const protocolSchema = z.literal("pidex-local-control-v1");
export const roleSchema = z.enum([
  "cli",
  "launcher",
  "daemon",
  "maintenance",
]);
export type LocalControlRole = z.infer<typeof roleSchema>;
