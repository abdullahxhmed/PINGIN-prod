import { z } from "zod";

export const edesyWebhookSchema = z.object({
    event: z.enum([
        "session.created",
        "call.incoming",
        "call.connected",
        "call.ended",
        "call.missed",
        "session.expired",
    ]),

    reference: z.string().optional(),
    virtual_number: z.string().optional(),
    caller: z.string().optional(),
    callee: z.string().optional(),
    direction: z.string().optional(),
    call_sid: z.string().optional(),
    duration_sec: z.number().int().nonnegative().optional(),
    billed_duration_sec: z.number().int().nonnegative().optional(),
    cost: z.union([z.number(), z.string()]).optional(),
    cost_paise: z.number().int().nonnegative().optional(),
    status: z.string().optional(),
    timestamp: z.string().optional(),
});


export type EdesyWebhookPayload =
    z.infer<typeof edesyWebhookSchema>;