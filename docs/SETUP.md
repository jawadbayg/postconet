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

## 3. Email / password authentication

1. Left sidebar → **Authentication** → **Providers**.
2. Open **Email**. Enable it. Enable **Confirm email**.
3. Leave phone/OAuth off unless you add them later. PostConet’s login form is email + password.

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

### Auth SMTP (skip until you have a domain)

**Do not enable Custom SMTP yet.** Leave the page cancelled / off.

You cannot honestly fill `noreply@yourdomain.com` without a domain, and Gmail/Outlook will reject or spam mail from an unverified host. While developing, keep Supabase’s **built-in** Auth email (rate-limited, check spam). That is enough for sign-up confirmation and password reset.

When you have a domain, use Resend (or similar) twice:

- **Auth SMTP** (this page): so verification mail comes from `noreply@yourdomain.com`
- **Edge Function secrets** `RESEND_API_KEY`: so *collection sharing* mail is sent (Auth SMTP never sends those)

Do **not** assume Auth SMTP will send “someone shared a collection with you” emails.

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

- `sync-push`, `sync-pull`
- `share-invite`, `share-accept`, `share-manage`, `share-landing`
- `invite-accept`, `account-delete` (org/account)

```bash
npx supabase functions deploy sync-push
npx supabase functions deploy sync-pull
npx supabase functions deploy share-invite
npx supabase functions deploy share-accept
npx supabase functions deploy share-manage
npx supabase functions deploy share-landing
```

Set secrets (Dashboard → Edge Functions → Secrets, or CLI):

```bash
npx supabase secrets set RESEND_API_KEY=re_...
npx supabase secrets set INVITE_FROM_EMAIL="PostConet <invites@yourdomain.com>"
npx supabase secrets set APP_INVITE_URL="https://YOUR_PROJECT.supabase.co/functions/v1/share-landing"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically for deployed functions. Do not put the service role in the desktop env.

`share-landing` is public (`verify_jwt = false`) so the invitation button works from Gmail, Outlook, and other inboxes.

---

## 6. Transactional email for sharing (Resend)

Sharing invitations are **not** Auth emails.

1. Create a [Resend](https://resend.com) account.
2. Add and verify your sending domain (required for Gmail/Outlook deliverability). For a first test you can use Resend’s onboarding sender, then switch to `invites@yourdomain.com`.
3. Create an API key. Store it only as `RESEND_API_KEY` in Edge Function secrets.
4. Set `INVITE_FROM_EMAIL` to a verified sender.
5. Send a test share to a Gmail address, an Outlook address, and a mailbox on your domain.

If `RESEND_API_KEY` is missing, the invite is still stored (expiry + accept-after-signup) but the email is not sent. The Share dialog reports that.

---

## 7. Realtime

Dashboard → **Database** → **Publications** (or **Replication**): `supabase_realtime` should include `change_log`, `notifications`, `resource_shares`, `share_invitations` (migrations add these). Without that, in-app share notifications and live sync need a manual **Sync now**.

---

## 8. Confirm the wiring

1. Restart the desktop app after `.env` is filled.
2. Gear (bottom of the left rail) → **Sign up** with a real inbox.
3. Verify the Auth email, then **Log in**.
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
