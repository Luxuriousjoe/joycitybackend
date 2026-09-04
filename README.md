# Joy City International Backend

Node.js/Express API for the Joy City International mobile app, backed by PostgreSQL.

## Local setup

1. Copy `.env.example` to `.env` and provide a PostgreSQL `DATABASE_URL`.
2. Run `npm install`.
3. Run `npm run db:migrate`.
4. Run `npm start`.

## Render settings

- Root Directory: `joycitybackend-main`
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

Email/device verification requires these Render environment variables:

- `RESEND_API_KEY`: a Resend sending API key kept only on the backend.
- `RESEND_FROM_EMAIL`: a sender on your verified domain, for example
  `Joy City <verify@updates.example.com>`.
- `EMAIL_VERIFICATION_SECRET`: a long random secret used to hash verification
  codes; the Blueprint generates it automatically.

Verification codes expire after five minutes. Resends are limited to once every
two minutes, and a device is trusted only after the correct code is submitted.

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

Administrators can create, edit, or delete dated Timely Reflections from the mobile
app under **Settings → Administration → Timely Reflection**. PostgreSQL stores
the title, scripture reference and text, reflection message, closing prayer,
author, publish date, and draft/published state. Members see the most recent
published reflection whose publish date is today or earlier on the Home screen.

The deployment start command runs `npm run db:migrate`, which creates the
`timely_reflections` table automatically. The endpoints are:

- `GET /api/reflections/current` for authenticated members
- `GET /api/admin/reflections/latest` for administrators
- `GET /api/admin/reflections` to list reflections for management
- `PUT /api/admin/reflections` to save or publish a reflection
- `PUT /api/admin/reflections/:id` to edit a specific reflection
- `DELETE /api/admin/reflections/:id` to delete a specific reflection

## Member engagement features

The same idempotent PostgreSQL migration now creates the event calendar,
listening progress, sermon notes, testimony moderation, and smart-notification
tables. Render applies these additions automatically at the beginning of the
configured start command.

- `/api/events` exposes published events; `/api/events/admin` provides admin CRUD.
- `/api/engagement/progress` stores per-member audio/video positions.
- `/api/engagement/notes` stores private sermon notes for the signed-in member.
- `/api/testimonies` accepts written, photo, audio, and video submissions;
  `/api/testimonies/admin` supports review, rejection, publication, and featuring.
- `/api/notifications` provides the member inbox and preferences;
  `/api/notifications/admin` supports immediate or scheduled campaigns for all
  members, one department, or one member.

New events, newly uploaded sermons, published Timely Reflections, and featured
testimonies create notification-inbox entries automatically. Event creation also
schedules a 24-hour reminder when enough time remains.

## Firebase push delivery

Set these only in Render or your local untracked .env:

    FIREBASE_PROJECT_ID=joycityinternational-8bbd0
    FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
    PUSH_NOTIFICATIONS_ENABLED=true
    PUSH_BATCH_SIZE=500
    PUSH_MAX_ATTEMPTS=8

Create the service-account JSON in Firebase/Google Cloud and paste the complete
JSON as one Render secret. Do not add the JSON or private key to Git. The
npm run db:migrate startup step creates device-token and per-device delivery
tables. The server dispatches due notifications once per minute, respects each
member's category and quiet-hour preferences, retries transient failures, and
deactivates invalid FCM tokens.

Authenticated device endpoints are:

- POST /api/notifications/devices/register
- DELETE /api/notifications/devices/unregister
- GET /api/notifications/devices/status

The /health response reports whether push is enabled and configured without
returning any credential material.
