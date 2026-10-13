# AddiSon Designs Shop Workflow

The app is a static website hosted with GitHub Pages. Signed-in shop users access shared boards and jobs stored in Supabase.

## App files

- `index.html` — app interface and Supabase authentication/data sync
- `manifest.json`, `sw.js`, `icon.svg` — installable app metadata and offline shell

## Data and access

- Supabase stores the boards, workflow stages, job records, and board colors.
- Users must sign in with an AddiSon Designs profile to access shop data.
- The browser app uses Supabase's publishable key. Never put a service-role key or user password in the public website source.
- Database row-level security controls access to the shop data; the GitHub repository contains only the app source, not job records.

## Publishing

The GitHub Pages project site URL is expected to be:

`https://addison-designs.github.io/addison-designs-workflow/`

Enable GitHub Pages for the `main` branch and the repository root. The app's manifest and service worker use relative paths so they work from the project URL.

After publishing, set the Supabase Auth Site URL and allowed redirect URL to the published app URL so sign-in invitation links return to the app.
