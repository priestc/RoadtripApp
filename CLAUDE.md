@AGENTS.md

# Development / test deployment

All development and manual testing of this app happens on **tank2**, a
machine on the local network (not this checkout, and not wherever this
Claude Code session happens to be running) — reachable over SSH as `tank2`
(see `~/.ssh/config`; resolves to `chris@192.168.1.190`, also `tank2.lan`).

- App checkout: `/home/chris/RoadtripApp` on tank2, cloned from
  `github.com/priestc/RoadtripApp` (same repo as this one). It has its own
  `.env.local` with real API keys — never print/cat its contents.
- Served as a **production build**, not `next dev`: `npm run build` then
  `npm run start` (`next start`), listening on `PORT=3737`.
- **nginx** (`/etc/nginx/sites-available/roadtrip`) reverse-proxies
  `http://roadtrip.lan` (port 80; `roadtrip.local` still works) → `http://127.0.0.1:3737`.
  `roadtrip.lan` resolves via the OpenWrt router's DNS (on the LAN and over Tailscale) to tank2's IP.
- The server runs as a **systemd user service**, `roadtrip.service`
  (`~/.config/systemd/user/roadtrip.service` on tank2; lingering is on, so it
  starts at boot and restarts on failure). It runs `next start` with
  `PORT=3737` using nvm's Node 24 (`~/.nvm/versions/node/v24.19.0`).
  Manage it with `systemctl --user {status,restart,stop} roadtrip`; logs via
  `journalctl --user -u roadtrip -f`.

**To test local changes on the real app**: commit + push to GitHub, then on
tank2 — `git pull`, `npm run build`, then `systemctl --user restart roadtrip` (since `next
start` serves whatever's already in `.next/`, a stale build won't reflect
new code even after `git pull`).

