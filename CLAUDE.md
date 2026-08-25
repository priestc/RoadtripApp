@AGENTS.md

# Development / test deployment

All development and manual testing of this app happens on **tank2**, a
machine on the local network (not this checkout, and not wherever this
Claude Code session happens to be running) — reachable over SSH as `tank2`
(see `~/.ssh/config`; resolves to `tank2.local` / `chris@192.168.1.190`).

- App checkout: `/home/chris/RoadtripApp` on tank2, cloned from
  `github.com/priestc/RoadtripApp` (same repo as this one). It has its own
  `.env.local` with real API keys — never print/cat its contents.
- Served as a **production build**, not `next dev`: `npm run build` then
  `npm run start` (`next start`), listening on `PORT=3737`.
- **nginx** (`/etc/nginx/sites-available/roadtrip`) reverse-proxies
  `http://roadtrip.local` (port 80) → `http://127.0.0.1:3737`.
  `roadtrip.local` resolves via mDNS on the LAN to tank2's IP.
- The server process is started detached so it survives the SSH session
  that launched it:
  ```
  cd ~/RoadtripApp && source ~/.nvm/nvm.sh && nvm use 24 >/dev/null \
    && setsid env PORT=3737 npm run start > ~/RoadtripApp/server.log 2>&1 < /dev/null &
  disown
  ```
  Logs land in `~/RoadtripApp/server.log`. There's no pm2/systemd/tmux
  managing it — it's just a detached background process (found via
  `ps aux | grep next-server` on tank2).

**To test local changes on the real app**: commit + push to GitHub, then on
tank2 — `git pull`, `npm run build`, kill the old `next-server`/`npm run
start` process tree, and relaunch it with the command above (since `next
start` serves whatever's already in `.next/`, a stale build won't reflect
new code even after `git pull`).

