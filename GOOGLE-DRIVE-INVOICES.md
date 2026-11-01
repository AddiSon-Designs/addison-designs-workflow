# Invoice PDFs in Google Drive

The invoice Send button continues to send the existing email, PDF attachment, and
shop copy. It renders the invoice paper already shown in the app, using its print
presentation. After the email provider confirms success, the Supabase function saves that same PDF under
the configured Invoices folder, using the invoice's creation date:

`Invoices / YYYY / MM / Customer Name_Invoice#.pdf`

The PDF retains the displayed logo, branding, customer details, order, line
descriptions, quantities, prices, sizes, fees, discount, and total. Editing controls
are omitted, as in the existing browser Print / Save PDF view. The PDF captures
the displayed layout as images, so it preserves browser text rendering but is not
searchable text. The email attachment and Drive upload use identical PDF bytes.
Older clients without a captured PDF keep the existing server-rendered attachment
layout. Filenames retain Unicode but replace slashes and control characters.
The browser bundle and its license notices are vendored under `vendor/`; no CDN or
paid PDF service is needed. PDFs are limited to 15 MiB and 100 pages.

If Drive saving fails, email success still moves the order to Invoiced. The invoice
shows the save error and an admin-only **Retry PDF save** button. That retry never
sends an email. Repeat saves reuse the file identified by organization and invoice
number within the month folder. Folder creation is not transactional: simultaneous
first sends can create duplicate folders; normal sequential saves reuse folders.

## Remaining account setup

The supplied Google project is `addison-designs-invoice-auto` (visible in the
Google Console URL). The supplied destination folder is
`17md6zrN4vEL01hYbNe0Lr--je6_JJ3rM`. Access to it has not been verified.
No billing activation, purchases, or new paid services are needed by this code.

1. In that project's Google Auth Platform, create a **Web application** client
   named **AddiSon Invoice Drive**. Leave JavaScript origins empty and set the
   authorized redirect URI to `https://developers.google.com/oauthplayground`.
   Keep the downloaded client credentials private.
2. Ensure the Google Drive API is enabled. Configure the consent audience for the
   account owning the destination folder. If the app is in Testing, add that
   account as a test user. For unattended use, resolve the consent app's publishing
   status: external Testing refresh tokens for Drive permissions normally expire
   after seven days. Google can require additional steps for the chosen audience
   and scope; do not treat a testing token as permanent authorization.
3. Open Google's [OAuth Playground](https://developers.google.com/oauthplayground).
   In its settings, select **Use your own OAuth credentials** and enter the client
   ID and client secret there. Use offline access and request the scope
   `https://www.googleapis.com/auth/drive`. This scope lets the server use the
   existing folder without introducing a Drive Picker into the shop app. Review
   Google's permission screen: this scope grants broad Drive access to the
   authorized account. Sign in with an account allowed to add files to the folder.
4. Exchange the authorization code for tokens in Playground. Store the refresh
   token securely. Do not paste the client secret or refresh token into chat,
   public source, screenshots, or this repository.
5. In the **Supabase project** `ntnrnegftzmcfctnmudt`, open **Edge Functions → Secrets**
   and add the settings below. These are production function settings, distinct
   from Codex's cloud environment settings. Preserve existing email secrets.

| Setting | Value |
| --- | --- |
| `GOOGLE_DRIVE_CLIENT_ID` | Client ID from Google |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Client secret from Google; private |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | Refresh token from Playground; private |
| `GOOGLE_DRIVE_INVOICES_FOLDER_ID` | `17md6zrN4vEL01hYbNe0Lr--je6_JJ3rM` |
| `GOOGLE_DRIVE_ORGANIZATION_ID` | Existing shop organization UUID from Supabase's `profiles.organization_id` |
| `GOOGLE_DRIVE_INVOICE_ENABLED` | `true`, after authorization is configured |

The organization setting prevents members of another shop from using this shop's
Drive credentials. An administrator with Supabase SQL Editor access can inspect
the existing admin memberships without changing data:

```sql
select user_id, organization_id, role
from public.profiles
where role = 'admin';
```

The function also retains its existing `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`RESEND_API_KEY`, and `EMAIL_FROM` requirements. No Google secret goes in the
browser. Do not replace working email configuration.

## Validate and deploy

From `supabase/functions/customer-email-alert`, with Deno 2 installed:

```sh
deno task check
deno task test
```

The tests use fixture credentials and mocked providers. They cover real PDF
generation, byte-identical attachment/upload, malformed PDF rejection, year/month
creation, existing-file updates, account restrictions, authorization and Drive
failures, email attachment and shop-copy preservation, and PDF-only retries. They
do not establish live Google or Supabase authorization.

Deploy the function through an authorized Supabase account before publishing the
updated static site:

```sh
supabase functions deploy customer-email-alert --project-ref ntnrnegftzmcfctnmudt --use-api
```

Publish the static files through the repository's existing GitHub Pages workflow.
The service-worker cache version changes so existing installations get the new
interface and locally served PDF renderer. Deploying the function alone does not
activate Drive uploads: the Google settings and enabled flag must also be verified.

After deployment and authorization, use an invoice whose test recipient you
control. Verify one email arrives, the PDF appears in the expected folder, and its
contents and total match the invoice. An archive-only retry should update the PDF
without producing another email. Live sending requires explicit authorization for
the selected recipient; do not use a real customer for a smoke check.
