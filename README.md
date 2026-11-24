# Our Daily Bread · Church Ministry

Single-page app (`index.html`) with Supabase login, roles, and cloud data.

## Setup (about 10 minutes)

### 1. Supabase (do these in order)
1. Create a project at supabase.com.
2. **SQL Editor** -> New query -> paste all of `supabase/schema.sql` -> Run (must finish with no error).
3. **Authentication -> Providers -> Email**: turn OFF "Confirm email".
4. **Authentication -> Users -> Add user -> Create new user**: email `host@ourdailybread.app`, password `12345678`, tick **Auto Confirm User**. (Do this AFTER step 2 so it becomes the Host.)
5. **Project Settings -> API**: copy the Project URL and the LEGACY anon public key (long, starts with `eyJ`, under the "Legacy API Keys" tab) into `supabase-config.js`. (Never the service_role key.)
6. **Authentication -> URL Configuration**: set Site URL to your GitHub Pages address.

### 2. GitHub
1. Create a repo and upload everything in this folder, including the hidden `.github` folder (or push with git).
2. **Settings -> Pages -> Source: GitHub Actions**. Each push to `main` redeploys. Your site goes live at `https://<user>.github.io/<repo>/`.

### 3. Logging in
The Host signs in with username **Host** and password **12345678** (change it after first login). There is exactly one Host; the app and database both refuse to create or promote a second. Everyone else signs up in the app and starts as Youth; people who pick "Evangelist" appear in the Host's Community screen with an Approve button.

## Roles
| | Youth | Evangelist | Host |
|---|---|---|---|
| Own attendance, notes, prayer, journal | yes | yes | yes |
| Post in Community, edit own posts | yes | yes | yes |
| Post/delete announcements, delete any Community post | no | yes | yes |
| View all members' meditations | no | yes | yes |
| Manage songs library and Drive links, giving details | no | yes | yes |
| Approve Evangelists, remove members, see online list | no | no | yes |

## How data is handled
- **Login/roles:** Supabase Auth + `profiles` table. Passwords are never stored in the app data. Only the Host can change roles or remove members (enforced by the database, not the browser).
- **Personal data** (attendance, notes, prayer requests, student log, notifications...) is a private row per user; nobody else can read it.
- **Shared data** (community posts, announcements, events, giving details, meditation journals, plans, songs...) is visible to every signed-in member and updates live on other devices. Only Host/Evangelists can change announcements, giving details and the songs library (enforced by the database).
- Which keys are personal vs shared is listed at the top of `supabase-sync.js`.

## Known limits
- Meditation journals are shared rows; the app hides other people's drafts in the interface, but a technical member could read them through the API. Move `med` to the personal list in `supabase-sync.js` if you want strict privacy (leaders then won't see members' journals).
- Shared lists are saved per key (last writer wins). Fine for a church group; very heavy simultaneous editing of the same list can drop changes.
- Profile photos are stored in the database as small images. Keep them small.
- Leave `supabase-config.js` blank to run local-only (old localStorage mode).
