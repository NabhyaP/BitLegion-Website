import { z } from 'zod';

/**
 * CF OIDC callback query-string shape.
 * We only validate the presence of `code` and `state` here; token validation
 * happens inside the openid-client library.
 */
export const cfCallbackQuerySchema = z
  .object({
    code: z.string().min(1),
    state: z.string().min(1),
  })
  .strict();

export type CfCallbackQuery = z.infer<typeof cfCallbackQuerySchema>;
