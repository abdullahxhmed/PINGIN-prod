import { z } from "zod";
const envSchema = z.object({
    PORT: z.coerce.number(),
    NODE_ENV: z.enum(["development", "prodution", "testing"])
});
const env = envSchema.parse(process.env);
//# sourceMappingURL=env.js.map