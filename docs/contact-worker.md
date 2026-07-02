# Contact Worker

This Worker handles `POST /api/contact` for `umnhoj.com`.

The public site can stay on GitHub Pages. Cloudflare routes only `/api/contact`
to this Worker, so the visible contact form should not be published until the
Worker is deployed and tested.

## Cloudflare prerequisites

- `umnhoj.com` must be active in Cloudflare and proxied through Cloudflare.
- `johnmu.dev` must be onboarded to Cloudflare Email Service / Email Routing.
- `noreply@johnmu.dev` is the fixed sender address.
- The destination inbox must be a verified Cloudflare destination address.
- The Turnstile widget must allow `umnhoj.com` and use action `contact`.

## Deploy

Install the local Worker toolchain:

```sh
npm install
```

Authenticate Wrangler if needed:

```sh
npx wrangler login
```

Add the required secrets. Paste the values only into Wrangler's prompt:

```sh
npm run contact:secret:turnstile
npm run contact:secret:destination
```

Deploy the Worker:

```sh
npm run contact:deploy
```

## Smoke tests

`GET` requests should be rejected:

```sh
curl -i https://umnhoj.com/api/contact
```

A request without a valid Turnstile token should be rejected with a generic
message:

```sh
curl -i -X POST https://umnhoj.com/api/contact \
  -H 'content-type: application/json' \
  --data '{"name":"Test","email":"test@example.com","message":"Hello","cf-turnstile-response":"invalid","website":""}'
```

After those pass, publish the static `/contact` form that obtains a real
Turnstile token and posts to this endpoint.
