# Get an IGDB key

**Used for:** searching video games.
**Site:** [dev.twitch.tv](https://dev.twitch.tv)
**Last checked:** _not yet written up_

IGDB runs on Twitch's sign-in, so the key is a **Client ID** and a **Client Secret** from a Twitch application. Both go into Listulator.

## 1. Make a Twitch account with two-factor sign-in

Create a Twitch account and turn on **Two-Factor Authentication** (Twitch will not let you create an application without it).

<!-- TODO screenshot: images/igdb-1-two-factor.png — Twitch security settings with 2FA on -->

## 2. Register an application

Open the [Twitch Developer Portal](https://dev.twitch.tv/console) → **Applications** → **Register Your Application**:

- **Name:** anything
- **OAuth Redirect URLs:** `http://localhost`
- **Category:** Application Integration
- **Client type:** Confidential

<!-- TODO screenshot: images/igdb-2-register-app.png — the registration form, filled in -->

## 3. Generate a secret

Click **Manage** next to your application, then **New Secret**.

<!-- TODO screenshot: images/igdb-3-new-secret.png — the Manage page with the Client ID and New Secret button; hide the secret -->

## 4. Copy both into Listulator

Copy the **Client ID** and the **Client Secret**, open **Settings → API keys** in Listulator, paste both into the IGDB row and press **Test**. The pill should say **Working**.
