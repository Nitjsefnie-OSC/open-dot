import { Effect, Layer } from "effect";
import { OpenCode, OpenCodeError, type SessionInput } from "../src/opencode";

const broken = (message: string) => Effect.fail(new OpenCodeError({ message }));

/** An in-memory OpenCode. "lost" admits the prompt but reports a failure, like a dropped response. */
export function fakeOpenCode() {
  const state = {
    sessions: new Set<string>(),
    messages: new Set<string>(),
    created: [] as SessionInput[],
    prompted: [] as string[],
    create: "ok" as "ok" | "fail",
    prompt: "ok" as "ok" | "fail" | "lost",
  };
  const layer = Layer.succeed(OpenCode, {
    sessionExists: (sessionID) => Effect.sync(() => state.sessions.has(sessionID)),
    createSession: (input) =>
      state.create === "fail"
        ? broken("connection reset")
        : Effect.sync(() => {
            state.created.push(input);
            state.sessions.add(input.id);
          }),
    messageExists: ({ messageID }) => Effect.sync(() => state.messages.has(messageID)),
    queuePrompt: ({ messageID }) => {
      if (state.prompt === "fail") return broken("connection refused");
      state.prompted.push(messageID);
      state.messages.add(messageID);
      return state.prompt === "lost" ? broken("connection reset") : Effect.void;
    },
  });

  return { state, layer };
}
