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
