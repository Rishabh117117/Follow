# Public mirror auto-sync — one-time setup

`mirror-to-public.yml` pushes this repo's tree to the public snapshot mirror
**`Rishabh117117/Follow`** on every push to `main`. It stays **inert (green, no-op)**
until you add one deploy key — nothing publishes until you do this.

## Why a deploy key (not a PAT)

A deploy key is scoped to exactly one repo (the mirror). A leaked PAT could
touch every repo you own; a leaked deploy key can only touch `Follow`.

## Steps (~2 min, all in your terminal + GitHub UI)

1. **Generate a keypair** (no passphrase — CI can't type one):

   ```bash
   ssh-keygen -t ed25519 -f follow-mirror -N "" -C "workspace-platform mirror"
   ```

   This writes `follow-mirror` (private) and `follow-mirror.pub` (public).

2. **Add the PUBLIC key to the mirror repo** with write access:
   `github.com/Rishabh117117/Follow` → **Settings → Deploy keys → Add deploy key**
   → paste the contents of `follow-mirror.pub` → **check "Allow write access"** → Add.

3. **Add the PRIVATE key as a secret in THIS repo:**
   `github.com/Rishabh117117/workspace-platform` → **Settings → Secrets and variables
   → Actions → New repository secret** → name it exactly **`MIRROR_DEPLOY_KEY`** →
   paste the entire contents of `follow-mirror` (the private file, including the
   `-----BEGIN/END OPENSSH PRIVATE KEY-----` lines) → Add.

4. **Delete the local key files** — GitHub now holds both halves:

   ```bash
   rm follow-mirror follow-mirror.pub
   ```

5. **Trigger the first run:** **Actions** tab → _Mirror to public repo_ → **Run workflow**
   (or just push anything to `main`).

## What it does each run

- Runs **gitleaks** on the exact tree it's about to publish. **Any finding aborts
  the run before the push** — a secret committed to `main` will NOT auto-leak to the
  public mirror (fail-closed). Tune false positives in `../../.gitleaks.toml`.
- Syncs additions, edits, **and deletions**, while preserving the mirror-only
  `demo/` folder (the portfolio sandbox, not in this repo).

## Turning it off

Delete the `MIRROR_DEPLOY_KEY` secret (reverts to inert), or delete this workflow.
