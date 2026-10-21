# Pollen

Turn video into dense, living particle footage. Pick a look (particles, gas, polygons, circles, bubbles, stardust, embers, pixels), tune it, render it, download it.

## Run it

Needs Node 22.13 or newer.

```
npm install
npm start
```

Open http://localhost:3000, create an account, and go to the Studio.

| Variable | Purpose |
| --- | --- |
| `PORT` | Port to listen on (default 3000) |
| `APP_SECRET` | Key used to encrypt 2FA secrets at rest. If unset, a random key is created in `data/master.key`. Set it in production and keep it stable. |
| `DATA_DIR` | Where the database and saved renders live (default `./data`) |
| `TRUST_PROXY` | Set to `1` behind a reverse proxy so client IPs and HTTPS are detected |
| `COOKIE_SECURE` | Set to `1` to force the `Secure` flag on the session cookie (do this on HTTPS) |

## How it works

**Rendering** (`public/js/engine.js`): a WebGL2 point renderer. The only CPU work per frame is uploading the current video frame as a texture. Each particle is derived from its vertex index in the vertex shader: it samples the video, picks a colour, is pushed forward/back by brightness and the subject mask, animated with simplex noise, and drawn as a shaped sprite (lit disc, gas puff, polygon, bubble, star, ember). Density goes up to 600k cells x 4 depth layers.

**Looks** (`public/js/forms.js`): each look is a recipe of shape, blending, motion and default slider values.

**Following the subject** (`public/js/mask.js`): *Motion* learns a background and treats whatever moves as the subject. *Person* uses MediaPipe selfie segmentation, loaded from jsDelivr on first use. The "Keep background" slider thins out particles outside the subject.

**Export**: the canvas is recorded in real time with `MediaRecorder` (MP4 where the browser supports it, otherwise WebM), with the clip's audio mixed in through WebAudio. Because it is real time, keep the tab visible while rendering. The result can be downloaded straight away and optionally saved to the account library.

## Accounts and security

- Passwords hashed with scrypt (N=32768), per-user salt, timing-safe comparison; unknown emails cost the same time as wrong passwords.
- Sessions are random 256-bit tokens, stored only as SHA-256 hashes, sent in `HttpOnly; SameSite=Lax` cookies.
- Two-factor: standard TOTP (RFC 6238), works with any authenticator app. Secrets are AES-256-GCM encrypted at rest, a used code can't be replayed, and 8 single-use recovery codes are issued (stored hashed). After the password step the session is "pending" and unlocks nothing until the second factor passes (5 tries, 5 minutes).
- Rate limits on sign-in, registration and sensitive account actions; cross-origin writes are rejected; strict CSP and other security headers.
- Changing your password or enabling 2FA signs out your other devices.

Not included yet: email verification and password reset by email (they need an email provider). Until then there is no self-service reset; a forgotten password means a new account.

## Layout

```
server/    index.js (app, headers), api.js (routes), sessions.js, security.js (crypto, TOTP), db.js (SQLite)
public/    index.html (landing), auth.html, studio.html, library.html, account.html
public/js  engine.js, forms.js, mask.js, demo.js, studio.js, ...
data/      created at runtime (database, saved renders) - git-ignored
```
