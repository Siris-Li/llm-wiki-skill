import { z } from "zod";

export const CommandSourceSchema = z.enum([
	"builtin",
	"pi-default",
	"user-global",
]);
export type CommandSource = z.infer<typeof CommandSourceSchema>;

export const CommandListQuerySchema = z.object({
	includeUserGlobal: z.enum(["true", "false"]).optional(),
}).strict();
export type CommandListQuery = z.infer<typeof CommandListQuerySchema>;

/** A command safe to show in the workbench UI. It intentionally omits local skill paths. */
export const CommandItemSchema = z.object({
	slug: z.string(),
	name: z.string(),
	description: z.string(),
	source: CommandSourceSchema,
	isProjectSkill: z.boolean(),
});
export type CommandItem = z.infer<typeof CommandItemSchema>;

export const CommandListDataSchema = z.array(CommandItemSchema);
export type CommandListData = z.infer<typeof CommandListDataSchema>;
