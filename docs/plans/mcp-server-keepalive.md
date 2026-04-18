
❯ okay, here is a big picture. we're writing a multiplayer RPG, that can be played by both humans, and LLMs. The game   is in ~/server/001-companion-online . Your harness (claude code) is in current directory. Observation:                  * I use the harness to spawn a sonnet, she's given a skill.md against the game's MCP
* she plays relatively well! and things are coming together, we're building a house
* after about 3-5 minutes, her MCP connection drops, and she re-spawns as a new character -losing all her inventory     * this is almost definitely an MCP timeout issue; we're identifying sessions using the mcp session ID header            * the question is, why did that got reset? this could be either your harness, or the game.                              Do an exploration, find the root cause, and explain it to me; exploration & explanation only (maybe with suggestions on  what we can do game-side about it); use as many subagents as necessary to find this.

● Let me launch parallel investigations into both the harness and the game server to find the root cause.

● 3 Explore agents finished (ctrl+o to expand)
├─ harness-mcp-explorer: Explore MCP session handling in harness · 46 tool uses · 82.4k tokens
│  ⎿  Done
├─ game-server-explorer: Explore game server MCP/session code · 47 tool uses · 54.9k tokens
│  ⎿  Done
└─ mcp-sdk-explorer: Explore MCP SDK timeout defaults · 30 tool uses · 75.1k tokens
⎿  Done

● Now let me verify one critical detail on the game server side.

Read 3 files (ctrl+o to expand)

● Let me check one more thing - the @hono/node-server serve function to see if it sets any timeouts.

Searched for 2 patterns (ctrl+o to expand)

● Bash(node -e "const http = require('http'); const s = http.createServer(); console.log('requestTimeout:',
s.requestTimeout); console.log('headersTimeout:', s.headers…)
⎿  requestTimeout: 300000
headersTimeout: 60000
keepAliveTimeout: 5000

Searched for 2 patterns (ctrl+o to expand)

● Got it. Here's the full root cause analysis.

---


Root Cause: Node.js requestTimeout kills SSE after 5 minutes

The chain of events

1. Agent connects — POST to /mcp creates a session, spawns a player entity with inventory                               2. SSE stream opens — GET to /mcp opens a long-lived HTTP request for server→client notifications
3. 5 minutes pass — Node.js HTTP server's default requestTimeout of 300,000ms (5 min) fires and kills the GET request   4. Server destroys everything — transport.onclose fires → destroySession() → world.removePlayer() — player entity +     inventory gone (mcp-session.ts:41)

5. Harness reconnects — detects the drop, clears its MCP client cache, calls connectToServer() fresh                    6. New session — POST arrives at /mcp with no mcp-session-id header → new UUID, new player entity, starting inventory   (2 Wood + 1 Rock)





I verified this directly:


$ node -e "const s = require('http').createServer(); console.log(s.requestTimeout)"
300000    ← 5 minutes, exactly your observed window




And @hono/node-server's serve() does not override this default. Your game server at main.ts:142 has no timeout          configuration.





Why "3-5 minutes" and not always exactly 5


The SSE stream (GET request) may not open at the exact same moment as the POST. The timeout counts from when Node.js    begins processing the request, and there can be jitter depending on when the client opens the notification channel.

Contributing factors (game-side)

1. No SSE keepalive — the MCP SDK's WebStandardStreamableHTTPServerTransport sends zero heartbeat/comment frames. Even   if Node's timeout were disabled, upstream proxies or the harness's own 45-second liveness timer (SSETransport.ts:21)
could eventually kill a truly silent stream.

2. Immediate destruction on disconnect — transport.onclose instantly deletes the player (app.ts:47-49). No grace
period, no chance to reconnect to the same session.

3. No session resumability — the MCP SDK supports an EventStore for resumable sessions, but it's not configured. Even
if the client tried to resume with Last-Event-ID, it wouldn't work.

Suggested game-side fixes


Fix 1 — Disable the request timeout (immediate, fixes the 5-min hard kill):
// main.ts, after line 142
const httpServer = serve({ fetch: app.fetch, port: PORT });
(httpServer as import('http').Server).requestTimeout = 0;
(httpServer as import('http').Server).headersTimeout = 0;




Fix 2 — Send SSE keepalive comments (protects against the harness's 45s liveness timer and any intermediate proxies):   The MCP SDK doesn't do this, so you'd need to periodically write SSE comment frames (: keepalive\n\n) on the            transport's writable stream, or use a thin wrapper. The harness expects server keepalives every ~15 seconds.



Fix 3 — Grace period on disconnect (resilience):

Instead of destroySession on transport.onclose, start a timer (e.g. 60s). If the same session ID reconnects within
that window, reattach. Only destroy after the timer expires.

Fix 4 — Decouple player identity from MCP session (most robust long-term):
Let the agent identify itself via a tool call (e.g. register({ name: "Sonnet" })), and look up existing player state
by that identity rather than by mcp-session-id. This way a reconnected session can inherit the old entity.            
Fix 1 alone will likely solve your immediate problem. Fix 2 is important if you ever deploy behind a reverse proxy.     Fixes 3-4 are defense-in-depth for a multiplayer game where disconnects are inevitable.

✻ Churned for 3m 5s