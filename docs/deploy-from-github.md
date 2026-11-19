# Deploy from GitHub (no Mac needed)

Since 2026-11-19 a push to `main` on GitHub deploys the app to Firebase project
`homestead-electric`. The workflow is `.github/workflows/deploy.yml`.

## What a push to main does

1. `npm install`, then `CI=true npm run build` (every prebuild gate runs; a
   failed gate stops the deploy, nothing goes live).
2. `firestore:rules` (skipped by Firebase when unchanged).
3. Cloud Functions, only when needed:
   - put a line `Deploy-functions: claudeReports,duetApi` in a commit message
     to deploy just those;
   - `Deploy-functions: none` skips functions, `Deploy-functions: all` deploys all;
   - no such line but files under `functions/` changed: all functions deploy.
   - It never deletes a live function. If code removes one, the deploy fails
     and Koy deletes it by hand.
4. Hosting (the built app), last.

`FUNCTIONS_DISCOVERY_TIMEOUT=120` is set for every run. A run whose commit is no
longer the tip of `main` stops before deploying, so an old run can't roll back.
Re-run or deploy by hand: GitHub > Actions > Deploy > Run workflow (on `main`).

## Sign-in: keyless, one-time setup

GitHub signs in to Google with Workload Identity Federation: no key file, no
GitHub secret. Only `koywilk/homestead-electric` on `refs/heads/main` can use it.

One-time, by someone with Owner on the Google Cloud project: open
https://console.cloud.google.com/home/dashboard?project=homestead-electric ,
click the Cloud Shell button (the `>_` icon, top right), and paste:

```bash
P=homestead-electric; N=318598172684; SA=github-deploy@$P.iam.gserviceaccount.com
gcloud config set project $P
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com
gcloud iam service-accounts create github-deploy --display-name="GitHub deploy"
for R in firebasehosting.admin firebaserules.admin cloudfunctions.admin cloudscheduler.admin secretmanager.viewer serviceusage.serviceUsageConsumer serviceusage.apiKeysViewer artifactregistry.reader; do gcloud projects add-iam-policy-binding $P --member="serviceAccount:$SA" --role="roles/$R" --condition=None --quiet >/dev/null && echo "ok $R"; done
gcloud iam service-accounts add-iam-policy-binding $P@appspot.gserviceaccount.com --member="serviceAccount:$SA" --role=roles/iam.serviceAccountUser --quiet >/dev/null && echo "ok actAs"
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"
gcloud iam workload-identity-pools providers create-oidc homestead-electric --location=global --workload-identity-pool=github --display-name="homestead-electric main" --issuer-uri="https://token.actions.githubusercontent.com" --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.repository_owner_id=assertion.repository_owner_id" --attribute-condition="assertion.repository=='koywilk/homestead-electric' && assertion.ref=='refs/heads/main' && assertion.repository_owner_id=='265636922'"
gcloud iam service-accounts add-iam-policy-binding $SA --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/projects/$N/locations/global/workloadIdentityPools/github/attribute.repository/koywilk/homestead-electric" --quiet >/dev/null && echo "ALL DONE"
```

The last line should print `ALL DONE`.

### Why these roles (least privilege for hosting + rules + v1 functions)

- `firebasehosting.admin`: upload and release the site.
- `firebaserules.admin`: release `firestore.rules`.
- `cloudfunctions.admin`: create and update functions, and set public invoker on
  new HTTPS / callable functions (Developer can't set that).
- `iam.serviceAccountUser` on `homestead-electric@appspot.gserviceaccount.com`
  only: functions run as that account.
- `cloudscheduler.admin`: the 16 scheduled functions' jobs.
- `secretmanager.viewer`: check the secrets functions bind (`ANTHROPIC_API_KEY`)
  without reading their values.
- `serviceusage.serviceUsageConsumer`, `serviceusage.apiKeysViewer`,
  `artifactregistry.reader`: checks the Firebase CLI makes before a deploy.

### Fallback: a JSON key instead

If an org policy ever blocks the keyless sign-in, a key also works: create one for
`github-deploy@homestead-electric.iam.gserviceaccount.com` and save its JSON as
the repo secret `FIREBASE_SERVICE_ACCOUNT` (GitHub > repo Settings > Secrets
and variables > Actions). The workflow uses the key whenever that secret exists.

## Deploying by hand still works

`firebase deploy` from `~/dev/homestead-electric` on Koy's Mac is unchanged.
