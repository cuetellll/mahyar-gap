# Mahyar Gap

Mahyar Gap is a browser-based communication platform: an Express/TypeScript API, PostgreSQL persistence through Prisma, Socket.IO realtime events, and LiveKit SFU transport for voice, video and screen sharing. The interface uses an original violet/cyan identity and Discord-inspired interaction patterns, with locally compiled Tailwind and a first-party design system.

## What is implemented

- **Accounts and profiles:** registration, login, bcrypt hashes, signed 30-minute bearer tokens, rate limits, profile editing (display name, bio, custom status, presence), and **avatar upload**. Avatars are cropped to 256×256 in the browser, sent as a size-limited image data URL, validated server-side (MIME plus magic bytes, ≤256 KB) and stored on the user row. They render in messages, the member list, DMs, voice participants, profile cards and the user panel.
- **Text channels:** persistent messages, replies, edits, deletes, pins, threads, emoji reactions, mentions, channel search over loaded history, unread indicators per channel and server, and "load earlier".
- **Realtime:** Socket.IO with authenticated handshakes, targeted `message:*`, `direct_message:*` and `voice:updated` events, reconnect handling, typing indicators for channels and DMs, and **live presence** derived from connected sockets (the database status is only used for idle/DND/invisible).
- **Voice/video:** server-issued LiveKit tokens scoped to one voice room with role-based publish grants. Real microphone, camera and screen-share tracks; speaking indicators; participant metadata (mute, camera, screen share, quality); device pickers; fullscreen stage; reconnect with exponential backoff.
- **Per-participant audio controls:** right-click (or long-press) a voice participant to open a polished context menu with a 0–200% volume slider, "mute for me", profile, DM and copy-ID actions. Volume is applied through a Web Audio `GainNode` per remote participant (never through system volume, never a second playback path) and persisted in `localStorage`. Deafening zeroes the graph gains, so it works through the Web Audio path.
- **Direct messages and calls:** 1:1 and group DMs with typing indicators, plus **real LiveKit calls**. `POST /api/dm/call-token` verifies conversation membership and blocked relationships, mints a room token for `dm_<conversationId>`, and notifies other participants over Socket.IO so they get an in-app incoming-call banner. The call stage shows real local/remote camera and screen tracks; there is no canvas placeholder.
- **Servers, channels and moderation:** server creation, invite codes, joining, channel creation/deletion, channel categories, role creation/editing, permissions, member role assignment, kick, ban, member removal and audit records. Authorization is enforced on the backend for REST and Socket.IO.
- **Appearance:** dark and light themes, reduced-motion preference, glow accents, glassy menus, message hover toolbars, skeletons/spinners, and a responsive layout with a mobile navigation drawer and touch-friendly participant menus.
- **Build and deploy:** local Tailwind build, locally bundled LiveKit browser client, CSP-safe delegated event handling (no inline handlers), Dockerfile, Railway manifest, health endpoint, Prisma initial migration, and a passing TypeScript build.

## Requirements

- Node.js 22.22.0 or newer and npm.
- PostgreSQL 13 or newer (Railway PostgreSQL works).
- A LiveKit project (WebSocket URL plus API key/secret) for voice, video, screen share and DM calls.
- A secure origin (`https://`, or `localhost`) for microphone, camera and screen capture.

## Local setup

```bash
cp .env.example .env
# Set DATABASE_URL, JWT_ACCESS_SECRET and the three LiveKit variables.
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm test
npm start
```

Open `http://localhost:3000`. `npm run build` produces `css/tailwind.generated.css`, `public/vendor/livekit-client.js` and the compiled server in `dist/`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (Railway provides it). |
| `JWT_ACCESS_SECRET` | Random secret, 32+ characters; required in production. |
| `BCRYPT_ROUNDS` | Password hashing cost (default 12). |
| `LIVEKIT_URL` | LiveKit server origin (`wss://…`). |
| `LIVEKIT_API_KEY` | LiveKit server API key (server only). |
| `LIVEKIT_API_SECRET` | LiveKit server secret (server only). |
| `CORS_ORIGIN` | Optional exact public origin for cross-origin browser access. |
| `PORT` | Supplied by Railway; defaults to 3000. |

Secrets never reach browser JavaScript. LiveKit tokens are minted server-side per room.

## Push to GitHub

The repository stays small on purpose: `node_modules`, `dist/` and `.env` are ignored, so a fresh clone is roughly 1 MB of source and you never upload installed packages. Everything that is generated is rebuilt on the server:

```bash
npm ci                 # install dependencies (also what Docker and CI run)
npx prisma generate    # Prisma client
npm run build          # Tailwind CSS, bundled LiveKit browser client, tsc
```

`.github/workflows/ci.yml` runs those checks on every push, and `.dockerignore` keeps the Docker build context small so Railway does not upload `node_modules` either.

1. Create an empty repository on GitHub (no README, no .gitignore — both already exist here).
2. Connect and push:

   ```bash
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main
   ```

Never commit `.env`; only `.env.example` is tracked.

## Deploy to Railway

1. Push this repository to GitHub, then create a Railway project from the repo. Railway uses the checked-in `Dockerfile` and `railway.json`, and builds the image on its own servers (`npm ci` → `prisma generate` → `npm run build`), so no build output is uploaded from your machine.
2. Add a PostgreSQL service and confirm the web service receives `DATABASE_URL`.
3. Add the LiveKit variables from your LiveKit project, set `NODE_ENV=production`, and set a fresh `JWT_ACCESS_SECRET`.
4. Deploy. The container runs `prisma migrate deploy` then starts the server on `$PORT`.
5. Wait for `/api/health` to return 200 (it checks database connectivity). This does not verify LiveKit media.
6. Verify with two authenticated browsers: register, upload avatars, create a server, exchange messages, join a voice room, test mute/deafen, right-click a participant and change their volume, run a DM call, then relaunch both browsers and confirm state.

## Known limitations (not hidden, not faked)

- **Attachments are not implemented.** There is no object-storage provider configured, so the upload control is absent and `uploadAttachment` throws an explicit 501 instead of pretending success. Adding S3/R2 storage plus a signed-upload endpoint is the remaining integration.
- **Avatars are small data URLs stored on the user row** (≤256 KB, validated). This keeps the feature real without object storage; moving them to R2 is recommended before large-scale use.
- **No email verification, password reset, MFA or refresh-token rotation.** Access tokens expire after 30 minutes and users sign in again. Tokens live in `localStorage`, so XSS prevention matters; the CSP blocks inline and eval scripts.
- **Private channels, channel-specific permission overrides and moderator hierarchy** are not implemented; the API rejects `is_private: true` rather than implying protection.
- **Forum and announcement channels render with their own icons and descriptions but do not implement post/thread workflows.**
- **Attachments, GIFs/stickers, message drafts and notification sound settings are not implemented.**
- **Search and "load earlier" operate on the messages loaded by the client** (up to 200 rows per table), not on an unbounded server-side history endpoint.
- **Single-instance Socket.IO.** No Redis adapter; multiple replicas would not share rooms.
- **Voice presence:** while you are in a room, LiveKit is authoritative. For channels you are not in, the UI shows the persisted join/leave rows, which can briefly outlive an abruptly closed browser tab.

## Tests

`npm test` runs the Node test suite covering the API client (auth header, 401 handling, error metadata, pagination), the CSP-safe delegated action contract (every button has a wired action, allowlist matches methods, no inline handlers), the local Tailwind build, Prisma order-by fields, and LiveKit grant construction. `npm run lint` is a TypeScript check.

Live integration testing against PostgreSQL, Socket.IO and LiveKit with two real users was **not** performed here because no database or LiveKit credentials were available in this environment.
