# Pollen

Turn video into something else. Rebuild it from particles (particles, polygons, circles, stardust, embers, pixels), repaint it as an animation (Toon, Anime, Kung Fu), or step inside it in 3D (Immersive). Tune it, render it, download it.

## Two ways to host it

**1. GitHub Pages (no server).** The whole site is the `public/` folder, and `.github/workflows/pages.yml` publishes it on every push to `main`. In the repo go to *Settings > Pages > Build and deployment > Source* and choose **GitHub Actions**. The site then lives at `https://<user>.github.io/<repo>/`.

With no server behind it, the app detects that and runs a browser-only backend (`public/js/localapi.js`): accounts, password hashing (PBKDF2), TOTP 2FA, recovery codes and the saved-video library are all stored in the visitor's own browser (IndexedDB). That means:
- accounts and saved videos stay on that one device and browser; they don't sync, and clearing site data erases them
- it is a convenience gate, not hardened security, since everything runs on the visitor's machine

**2. Node server (real accounts).** Same front end, but accounts, 2FA and videos are stored on the server and work from any device. Needs Node 22.13 or newer.

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

**Rendering** (`public/js/engine.js`): one WebGL2 context, three renderers. The only CPU work per frame is uploading the current video frame as a texture.
- *Particles*: each particle is derived from its vertex index in the vertex shader: it samples the video, picks a colour, is pushed forward/back by brightness and the subject mask, animated with simplex noise, and drawn as a shaped sprite (lit disc, polygon, star, ember). Density goes up to 600k cells x 4 depth layers.
- *Animate* (`toon.js`): a Kuwahara paint pass, a bloom chain and a style pass (colour bands, Sobel ink lines that "boil", grading, sparkles/petals/god rays). Frames can be held at 8/12/24 drawings a second like hand-drawn animation.
- *Immersive* (`immersive.js`): the frame wraps around the viewer as a mesh, every pixel pushed toward you along its own view ray by a depth map, inside a dome lit by the video with a reflective floor and a particle swarm. Depth comes from the sample clip's exact depth map, an optional AI model (Depth Anything V2 small via transformers.js, `depth.js` + `depth-worker.js`, WebGPU or WASM, downloaded from Hugging Face on first use), or a built-in estimate. Controls: drag, scroll/pinch, WASD/QE, click to ripple, phone gyro, side-by-side stereo, and WebXR headsets (thumbsticks walk and turn, trigger ripples).

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
