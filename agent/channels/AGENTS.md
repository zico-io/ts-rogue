channels are adapters that translate external requests to our agent's core system.
functions and business logic should instead be stored in @agent/lib

a channel supplies one `ChannelRenderer` (@agent/lib/channel.ts) and wires it
with `sessionEvents` (@agent/lib/session.ts). rendering is translation, so it
belongs here - and so does every platform limit, because this is the code that
posts. `textRenderer` already covers a channel whose only surface is posted
text; the rest of the lifecycle is not a channel's decision to make.
