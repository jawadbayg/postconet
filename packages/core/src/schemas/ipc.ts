import { z } from "zod";

export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export const signUpSchema = signInSchema.extend({
  displayName: z.string().min(1).max(80)
});

export const kvSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  enabled: z.boolean(),
  description: z.string().optional(),
  type: z.enum(["text", "secret", "file"]).optional(),
  filePath: z.string().optional()
});

export const sendHttpSchema = z.object({
  executionId: z.string(),
  workspaceId: z.string(),
  requestId: z.string().optional(),
  document: z.record(z.unknown()),
  authChain: z.array(z.object({ type: z.string(), params: z.record(z.string()) })),
  environmentId: z.string().nullable().optional()
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
