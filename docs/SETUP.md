# Setup

PostConet uses **one developer-owned Supabase project** for every user. The project URL and publishable (anon) key are baked in at **build time**. Users never type database configuration, and the desktop app must never contain a service-role key.

Offline mode does not need Supabase. Local collections stay in SQLite on this Mac.

## Prerequisites

- macOS 13+
- Node.js 20.19+ or 22.12+
- pnpm 9.15+
- Xcode Command Line Tools
- A [Supabase](https://supabase.com) account (for sign-in, sync, and sharing)

## 1. Install the app locally

```bash
pnpm install
cp .env.example apps/desktop/.env
pnpm --filter @postconet/core test
pnpm --filter @postconet/persistence test
pnpm dev
```

`pnpm dev` opens Electron. Until the two public values below are in `apps/desktop/.env`, use **Continue offline**. Existing local data is not deleted.

---

## 2. Create the central Supabase project (dashboard)

Do this **before** applying migrations.

1. Open [https://supabase.com/dashboard](https://supabase.com/dashboard) and sign in.
2. **New project**. Pick an org, name it (for example `postconet`), set a strong database password, and choose a region close to you. Wait until the project is healthy.
3. You will use **this one project** for all PostConet users. Do not ask end users to create their own.

### Project URL and publishable key

1. In the left sidebar open **Project Settings** (gear).
2. Open **API**.
3. Copy **Project URL** (`https://<ref>.supabase.co`).
4. Copy the **anon / public** key (labeled publishable). This key is designed to ship in clients; Row Level Security protects data.
5. **Do not** copy the **service_role** key into the desktop app, `.env` next to Electron, git, or screenshots you share with users.

Paste only the public pair into **`apps/desktop/.env`** on your machine:

```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Restart `pnpm dev` after saving. Packaged builds read the same names at compile time (`electron-vite` / `VITE_*`). Changing them later requires a new build, not a user setting.

### Where other secrets go (never the desktop app)

| Secret | Where to enter it | Used for |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `apps/desktop/.env` (dev) or CI build env | Public API host |
| `VITE_SUPABASE_ANON_KEY` | same | Publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **Edge Function secrets** (auto-provided as `SUPABASE_SERVICE_ROLE_KEY` when you deploy functions) and **`apps/worker/.env` only** if you run the worker | Server-side lookup, invite accept, worker |
| `RESEND_API_KEY` | Dashboard → **Edge Functions** → **Secrets** | Collection-sharing emails |
| `INVITE_FROM_EMAIL` | same Secrets page | From-address, e.g. `PostConet <invites@yourdomain.com>` |
| `APP_INVITE_URL` | same Secrets page | Public invite button URL, usually `https://<ref>.supabase.co/functions/v1/share-landing` |

Dashboard path for function secrets: **Edge Functions** → **Manage secrets** (or Project Settings → Edge Functions).  
Dashboard path for the service-role key (support/CLI only): **Project Settings → API → service_role**. Treat it like a root password.

---

## 3. Email / password authentication (v1: in-app users, no mail)

v1 accounts live in Supabase Auth but **do not send email**. Google Auth and SMTP can come later.

1. Left sidebar → **Authentication** → **Providers**.
2. Open **Email**. Enable it. **Turn Confirm email OFF.** If Confirm email stays on, signup still works because the app creates a confirmed user through the `register` function, but leftover Auth mails may fire.
3. Leave phone / Google / OAuth off for now.
4. Do **not** enable Custom SMTP.

Use any email-shaped login (`alice@postconet.local` is fine). It does not need a real inbox. Share only works for an address that already has an account.

### Redirect URLs (no PostConet domain required)

Leave **http://localhost:3000** — that is a Next.js default and is wrong for this desktop app. You do **not** need a custom domain.

1. **Authentication** → **URL Configuration**.
2. **Site URL** (must be https, used in email templates):

   `https://YOUR_PROJECT.supabase.co`

   Example: `https://wiytwgewlatdhpfthjsc.supabase.co`

3. Click **Add URL** for each **Redirect URL**:

   - `postconet://auth/callback`
   - `postconet://invite`
   - `https://YOUR_PROJECT.supabase.co/functions/v1/share-landing`
   - `https://YOUR_PROJECT.supabase.co/**`

4. Save.

The confirmation link in the email still goes to `*.supabase.co` first (https). After verify it can open the Mac app via `postconet://`. When you later buy a domain, you can change Site URL to `https://yourdomain.com` and keep the `postconet://` redirects.

### Auth SMTP (v1: leave off)

**Do not enable Custom SMTP.** Signup, sharing, and password reset do not send mail in this version. Sharing checks the Auth users table and writes an in-app notification only.

### CLI (this repo already has `supabase/`)

Do **not** run `supabase init` — it would overwrite the existing migrations and functions.

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

`link` may ask for the **database password** you chose at project creation. That password is only for CLI/SQL. Never put the `postgresql://postgres:...` URI in `apps/desktop/.env`.

---

## 4. Apply migrations and policies

The SQL in `supabase/migrations` creates tables, RLS, sharing, and helper functions. Apply **all** of them (`0001` … `0004`) before creating real users.

### Option A — Dashboard SQL editor (hosted project)

1. Left sidebar → **SQL Editor** → **New query**.
2. Paste the entire contents of **`supabase/dashboard_bootstrap.sql`** (all migrations in one file).
3. Click **Run**. Use this once on a fresh project. If a type/table already exists from a previous attempt, stop and use Option B or a new project.
4. **Database** → **Roles / Policies**: confirm RLS is enabled on `collections`, `folders`, `requests`, `environments`, `resource_shares`, `share_invitations`, `notifications`.

### Option B — Supabase CLI (recommended)

Link the dashboard project once:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

`YOUR_PROJECT_REF` is the subdomain in the Project URL.

### Local stack (optional)

```bash
npx supabase start
npx supabase db reset
```

Copy API URL + anon key from `npx supabase status` into `apps/desktop/.env`. Never copy `service_role` there.

---

## 5. Edge Functions (sharing + sync)

After pulling sync changes, re-apply SQL (`0005_sync_atomicity.sql` or the latest `dashboard_bootstrap.sql`) and redeploy `sync-push` / `sync-pull` so version checks and revision history take effect.

Deploy at least:

- `register` (in-app signup; JWT verification **off**)
- `sync-push`, `sync-pull`
- `share-invite`, `share-accept`, `share-manage`, `share-landing`
- `invite-accept`, `account-delete` (org/account)

```bash
npx supabase functions deploy register --no-verify-jwt
npx supabase functions deploy sync-push
npx supabase functions deploy sync-pull
npx supabase functions deploy share-invite
npx supabase functions deploy share-accept
npx supabase functions deploy share-manage
npx supabase functions deploy share-landing
```

`register` must be callable without a signed-in user. If you deploy from the dashboard, turn **Verify JWT** off for that function.

v1 does not need Resend secrets. Skip them until you add a domain.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically for deployed functions. Do not put the service role in the desktop env.

`share-landing` is public (`verify_jwt = false`) so the invitation button works from Gmail, Outlook, and other inboxes.

---

## 6. Transactional email for sharing (later)

v1 does **not** send share emails. If the address already has a PostConet account, they get an in-app notification. If it does not, Share returns “no account” — they must sign up in the app first.

When you have a domain, Resend can be wired back through `RESEND_API_KEY` for people who are not registered yet.

---

## 7. Realtime

Dashboard → **Database** → **Publications** (or **Replication**): `supabase_realtime` should include `change_log`, `notifications`, `resource_shares`, `share_invitations` (migrations add these). Without that, in-app share notifications and live sync need a manual **Sync now**.

---

## 8. Confirm the wiring

1. Restart the desktop app after `.env` is filled.
2. Gear (bottom of the left rail) → **Sign up** with any email-shaped address (for example `alice@postconet.local`) and a password. You are signed in immediately.
3. No verification email should arrive. If signup fails, deploy `register` with Verify JWT off.
4. Settings must show your email. It must **not** show a Supabase URL or key field.
5. Create a collection while signed in, sign out (offline local workspace remains), sign back in: cloud data hydrates without wiping newer local edits.
6. Sharing and RLS checks need a second user; see `docs/ACCEPTANCE.md`.

## CLI and worker

```bash
pnpm --filter @postconet/cli build
```

Worker (optional, monitors/hosted mocks): copy `.env.example` to `apps/worker/.env` and set `SUPABASE_SERVICE_ROLE_KEY` **there only**.

## Tests

```bash
pnpm test
```

Live RLS tests run only when `POSTCONET_IT_SUPABASE_URL` and two test user tokens are set.
