# Joy City International Backend

Node.js/Express API for the Joy City International mobile app, backed by PostgreSQL.

## Local setup

1. Copy `.env.example` to `.env` and provide a PostgreSQL `DATABASE_URL`.
2. Run `npm install`.
3. Run `npm run db:migrate`.
4. Run `npm start`.

## Render settings

- Root Directory: `JoyCity_backend`
- Build Command: `npm install`
- Start Command: `npm run db:migrate && npm run admin:bootstrap && npm start`
- Health Check Path: `/health`

Create a Render PostgreSQL database in the same region as the web service and
set the service's `DATABASE_URL` to its Internal Database URL.

The included `render.yaml` can create and connect both resources automatically
when this folder is used as the root of a Render Blueprint repository.

The permanent Render host is `https://grace-church-api.onrender.com`, and the
Flutter API base URL is `https://grace-church-api.onrender.com/api`. Do not
change or override this host unless the project owner explicitly requests it.

For the first deployment, configure `BOOTSTRAP_ADMIN_NAME`,
`BOOTSTRAP_ADMIN_EMAIL`, and `BOOTSTRAP_ADMIN_PASSWORD`. The startup command
creates or promotes that administrator. After you confirm login, remove all
three bootstrap variables so future deploys cannot reset the password.

## Create or promote an administrator

In the Render service shell:

```bash
read -p "Admin name: " ADMIN_NAME
read -p "Admin email: " ADMIN_EMAIL
read -s -p "Admin password: " ADMIN_PASSWORD; echo
export ADMIN_NAME ADMIN_EMAIL ADMIN_PASSWORD
npm run admin:create
unset ADMIN_NAME ADMIN_EMAIL ADMIN_PASSWORD
```

The password is stored as a bcrypt hash. If the email already exists, that
account is promoted to administrator, activated, and assigned the new password.

## Member registration

The mobile app creates regular member accounts through `POST /api/auth/register`.
It stores the member's name, normalized email, bcrypt password hash, and selected
department in PostgreSQL. New accounts cannot select the administrator role.

## Google Drive media storage

`POST /api/media` accepts the captured file as multipart form data in a field
named `file`. Render temporarily stores the incoming bytes, uploads them to the
folder selected for `photo`, `video`, or `audio`, saves the Drive file ID and
URL in PostgreSQL, and removes the temporary Render file.

For folders in a normal Google My Drive, use:

```env
GOOGLE_DRIVE_ENABLED=true
GOOGLE_DRIVE_AUTH_MODE=oauth
GOOGLE_DRIVE_CLIENT_ID=...
GOOGLE_DRIVE_CLIENT_SECRET=...
GOOGLE_DRIVE_REFRESH_TOKEN=...
GOOGLE_DRIVE_REDIRECT_URI=https://developers.google.com/oauthplayground
GOOGLE_DRIVE_MEDIA_FOLDER_ID=...
GOOGLE_DRIVE_PHOTO_FOLDER_ID=...
GOOGLE_DRIVE_VIDEO_FOLDER_ID=...
GOOGLE_DRIVE_AUDIO_FOLDER_ID=...
GOOGLE_DRIVE_THUMBNAIL_FOLDER_ID=...
GOOGLE_DRIVE_PUBLIC_FILES=true
```

The OAuth refresh token must have Google Drive access and belong to an account
that can edit every configured folder. Type-specific folder IDs fall back to
`GOOGLE_DRIVE_MEDIA_FOLDER_ID`, then `GOOGLE_DRIVE_FOLDER_ID`.

Use `GOOGLE_DRIVE_AUTH_MODE=service_account` only for a Google Workspace Shared
Drive and grant that service account access to the folders. Service accounts do
not own storage in a normal My Drive.

After setting Render variables, use `npm run drive:verify` in the Render shell.
It checks authentication and all unique folder IDs without printing credentials.
The `/health` response also reports whether Drive is configured, but it does not
make a network call to Drive.

## Timely Reflection

Administrators can create or update a dated Timely Reflection from the mobile
app under **Settings → Administration → Timely Reflection**. PostgreSQL stores
the title, scripture reference and text, reflection message, closing prayer,
author, publish date, and draft/published state. Members see the most recent
published reflection whose publish date is today or earlier on the Home screen.

The deployment start command runs `npm run db:migrate`, which creates the
`timely_reflections` table automatically. The endpoints are:

- `GET /api/reflections/current` for authenticated members
- `GET /api/admin/reflections/latest` for administrators
- `PUT /api/admin/reflections` to save or publish a reflection
