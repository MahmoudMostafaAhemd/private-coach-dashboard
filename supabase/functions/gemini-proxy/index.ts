import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = new Set([
  "https://mahmoudmostafaahemd.github.io",
  "http://127.0.0.1:4173",
  "http://localhost:4173"
]);

const MAX_BASE64_LENGTH = 8_000_000;
const DEFAULT_MODEL = "gemini-3-flash-preview";

type InbodyResult = {
  weight: number;
  visceralFat?: number;
  bodyAge?: number;
};

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null
) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Vary": "Origin"
  });

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, content-type");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }

  return new Response(JSON.stringify(body), { status, headers });
}

function validateModel(model: unknown) {
  if (typeof model !== "string" || !model.trim()) return DEFAULT_MODEL;

  const trimmed = model.trim();
  if (!/^gemini-[a-z0-9.-]{1,80}$/.test(trimmed)) {
    throw new Error("Invalid Gemini model name.");
  }

  return trimmed;
}

function parseGeminiJson(text: string): InbodyResult {
  const parsed = JSON.parse(text.trim()) as Partial<InbodyResult>;
  const weight = Number(parsed.weight);

  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error("Gemini response did not include a valid weight.");
  }

  return {
    weight,
    visceralFat: Number.isFinite(Number(parsed.visceralFat))
      ? Number(parsed.visceralFat)
      : undefined,
    bodyAge: Number.isFinite(Number(parsed.bodyAge))
      ? Number(parsed.bodyAge)
      : undefined
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse({ error: "Origin not allowed." }, 403, origin);
    }

    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin"
      }
    });
  }

  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse({ error: "Origin not allowed." }, 403, origin);
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, origin);
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return jsonResponse({ error: "Missing GEMINI_API_KEY secret." }, 500, origin);
  }

  try {
    const body = await req.json();
    const base64Data = String(body.base64Data || "");
    const mimeType = String(body.mimeType || "");
    const model = validateModel(body.model);

    if (!base64Data || !mimeType.startsWith("image/")) {
      return jsonResponse({ error: "A valid image payload is required." }, 400, origin);
    }

    if (base64Data.length > MAX_BASE64_LENGTH) {
      return jsonResponse({ error: "Image payload is too large." }, 413, origin);
    }

    const prompt =
      "Please scan this InBody report image and extract: 1. Total Weight in kg, 2. Visceral Fat level (V-fat), 3. Body Age. Return the data ONLY in the requested JSON structure schema, do not include markdown formatting or extra text.";

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                { inlineData: { mimeType, data: base64Data } }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                weight: { type: "NUMBER" },
                visceralFat: { type: "NUMBER" },
                bodyAge: { type: "NUMBER" }
              },
              required: ["weight"]
            }
          }
        })
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error("Gemini request failed", {
        status: geminiResponse.status,
        errorText: errorText.slice(0, 500)
      });

      return jsonResponse({ error: "Gemini request failed." }, 502, origin);
    }

    const geminiJson = await geminiResponse.json();
    const resultText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;

    if (typeof resultText !== "string") {
      return jsonResponse({ error: "Gemini returned an unexpected response." }, 502, origin);
    }

    return jsonResponse(parseGeminiJson(resultText), 200, origin);
  } catch (error) {
    console.error("gemini-proxy failed", error);
    return jsonResponse({ error: "Failed to process InBody image." }, 500, origin);
  }
});
