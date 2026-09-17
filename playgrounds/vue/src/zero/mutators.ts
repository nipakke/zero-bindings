import { defineMutatorWithType, defineMutatorsWithType, type Transaction } from "@rocicorp/zero";
import type { AppSchema } from "./schema.ts";

export type AppTransaction = Transaction<AppSchema, unknown>;

const defineAppMutator = defineMutatorWithType<AppSchema, unknown, unknown>();

export const mutators = defineMutatorsWithType<AppSchema>()({
  todo: {
    add: defineAppMutator(
      async ({
        tx,
        args,
      }: {
        tx: AppTransaction;
        args: { id: string; title: string };
        ctx: unknown;
      }) => {
        const title = args.title.trim();

        if (title === "") {
          throw new Error("A todo needs a title");
        }

        await tx.mutate.todo.insert({
          id: args.id,
          title,
          done: false,
          createdAt: Date.now(),
        });
      },
    ),
    setDone: defineAppMutator(
      async ({
        tx,
        args,
      }: {
        tx: AppTransaction;
        args: { id: string; done: boolean };
        ctx: unknown;
      }) => {
        await tx.mutate.todo.update({ id: args.id, done: args.done });
      },
    ),
    remove: defineAppMutator(
      async ({ tx, args }: { tx: AppTransaction; args: { id: string }; ctx: unknown }) => {
        await tx.mutate.todo.delete({ id: args.id });
      },
    ),
  },
});
