# Private Coach Dashboard

Static training dashboard for GitHub Pages.

## Local commands

```bash
npm run build
npm run dev
```

## Gemini setup

GitHub Pages is a static host, so a Gemini API key cannot be kept private inside the dashboard JavaScript. This project removes the settings button and uses a backend proxy URL instead.

Set the actual Gemini API key in your backend/proxy service, not in this GitHub Pages app. Use an environment secret named `GEMINI_API_KEY` in that backend service, for example a Cloudflare Worker secret, Netlify environment variable, Vercel environment variable, or a private server environment variable.

The dashboard is configured to use this Supabase Edge Function endpoint:

```text
https://gomvlijafqagznoexdsx.supabase.co/functions/v1/gemini-proxy
```

If you change proxy providers later, create a GitHub Actions secret named `GEMINI_PROXY_URL` with the replacement endpoint. The dashboard posts:

```json
{
  "base64Data": "...",
  "mimeType": "image/png",
  "model": "gemini-3-flash-preview"
}
```

The proxy should return:

```json
{
  "weight": 79.4,
  "visceralFat": 11.5,
  "bodyAge": 37
}
```

Optionally add a repository variable named `GEMINI_MODEL`; otherwise the workflow uses `gemini-3-flash-preview`.

## Deploy to GitHub Pages

1. Create a GitHub repository and push this project to `main`.
2. In the repository, open `Settings > Secrets and variables > Actions`.
3. Add `GEMINI_API_KEY` to the Supabase project Edge Function secrets.
4. Open `Settings > Pages` and set the source to `GitHub Actions`.
5. Push to `main`, or run the `Deploy GitHub Pages` workflow manually.

Do not inject `GEMINI_API_KEY` directly into this Pages build. Anything used by browser JavaScript can be viewed by site visitors.
