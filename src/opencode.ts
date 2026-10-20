import { AbsolutePath, OpenCode as Client, Session, SessionMessage } from "@opencode/client/effect";
import { Service } from "@opencode/client/service";
import { Context, Data, Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

export class OpenCodeError extends Data.TaggedError("OpenCodeError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const failed = (message: string) => (cause: unknown) => new OpenCodeError({ message, cause });

export interface SessionInput {
  readonly id: string;
  readonly directory: string;
  readonly title: string;
}

export interface MessageRef {
  readonly sessionID: string;
  readonly messageID: string;
}

/** The few OpenCode calls open-dot makes. Absence is a value, every other failure is an OpenCodeError. */
export class OpenCode extends Context.Service<
  OpenCode,
  {
    readonly sessionExists: (sessionID: string) => Effect.Effect<boolean, OpenCodeError>;
    readonly createSession: (input: SessionInput) => Effect.Effect<void, OpenCodeError>;
    /** True once OpenCode has admitted the message, whether it is still queued or already in the history. */
    readonly messageExists: (ref: MessageRef) => Effect.Effect<boolean, OpenCodeError>;
    /** Queues the text as a user message with the caller's ID. */
    readonly queuePrompt: (
      ref: MessageRef & { readonly text: string },
    ) => Effect.Effect<void, OpenCodeError>;
  }
>()("open-dot/OpenCode") {
  static readonly layer = Layer.effect(
    OpenCode,
    Effect.gen(function* () {
      const endpoint = yield* Effect.tryPromise({
        try: () => Service.discover(),
        catch: (cause) =>
          new OpenCodeError({ message: "Could not read the OpenCode service registration", cause }),
      });
      if (!endpoint) {
        return yield* new OpenCodeError({
          message: "OpenCode is not running. Start OpenCode, then try again.",
        });
      }
      const { url, auth } = endpoint;
      const headers = Service.headers(auth ? { url, auth } : { url }) ?? {};
      const client = yield* Client.make({ baseUrl: url }).pipe(
        Effect.provide(
          Layer.effect(
            HttpClient.HttpClient,
            Effect.map(
              HttpClient.HttpClient,
              HttpClient.mapRequest(HttpClientRequest.setHeaders(headers)),
            ),
          ).pipe(Layer.provide(FetchHttpClient.layer)),
        ),
      );

      return {
        sessionExists: (sessionID) =>
          client.session.get({ sessionID: Session.ID.make(sessionID) }).pipe(
            Effect.as(true),
            Effect.catchTag("SessionNotFoundError", () => Effect.succeed(false)),
            Effect.mapError(failed(`Could not look up session ${sessionID}`)),
          ),
        createSession: ({ id, directory, title }) =>
          client.session
            .create({
              id: Session.ID.make(id),
              title,
              location: { directory: AbsolutePath.make(directory) },
            })
            .pipe(Effect.asVoid, Effect.mapError(failed(`Could not create session ${id}`))),
        // Check the inbox first: a queued message moves from the inbox into the history, never back.
        messageExists: (ref) => {
          const sessionID = Session.ID.make(ref.sessionID);
          const messageID = SessionMessage.ID.make(ref.messageID);
          return client.session.inbox.list({ sessionID }).pipe(
            Effect.flatMap((inbox) =>
              inbox.some((item) => item.id === messageID)
                ? Effect.succeed(true)
                : client.session.message.get({ sessionID, messageID }).pipe(
                    Effect.as(true),
                    Effect.catchTag("MessageNotFoundError", () => Effect.succeed(false)),
                  ),
            ),
            Effect.mapError(failed(`Could not look up message ${ref.messageID}`)),
          );
        },
        queuePrompt: ({ sessionID, messageID, text }) =>
          client.session
            .prompt({
              sessionID: Session.ID.make(sessionID),
              id: SessionMessage.ID.make(messageID),
              text,
              delivery: "queue",
            })
            .pipe(Effect.asVoid, Effect.mapError(failed(`Could not send message ${messageID}`))),
      };
    }),
  );
}
