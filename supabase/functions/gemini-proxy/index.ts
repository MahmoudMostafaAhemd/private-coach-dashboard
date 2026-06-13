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

type SessionExercise = {
  name: string;
  target: string;
  plannedSets: number;
  completedSets: number;
  restSeconds: number;
  reps: string;
  note: string;
  completed: boolean;
};

type SessionPayload = {
  title: string;
  focus: string;
  currentWeight: number;
  totals: {
    completedSets: number;
    totalSets: number;
    completedExercises: number;
    totalExercises: number;
    completionPercent: number;
  };
  exercises: SessionExercise[];
};

type SessionAnalysis = {
  summary: string;
  score: number;
  estimatedCaloriesBurned: {
    kcal: number;
    low: number;
    high: number;
    basis: string;
  };
  fullAnalysis: {
    adherence: string;
    volume: string;
    intensity: string;
    muscleBalance: string;
    recovery: string;
    progression: string;
  };
  positives: string[];
  cautions: string[];
  nextFocus: string[];
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

function validateSessionPayload(session: unknown): SessionPayload {
  if (!session || typeof session !== "object") {
    throw new Error("A valid workout session payload is required.");
  }

  const raw = session as Record<string, unknown>;
  const totals = raw.totals as Record<string, unknown> | undefined;
  const exercises = Array.isArray(raw.exercises) ? raw.exercises : [];

  if (!totals || exercises.length === 0 || exercises.length > 20) {
    throw new Error("Workout session is missing exercise totals.");
  }

  const parsedExercises = exercises.map((exercise) => {
    const item = exercise as Record<string, unknown>;
    return {
      name: String(item.name || "").slice(0, 80),
      target: String(item.target || "").slice(0, 80),
      plannedSets: Math.max(0, Math.min(12, Number(item.plannedSets) || 0)),
      completedSets: Math.max(0, Math.min(12, Number(item.completedSets) || 0)),
      restSeconds: Math.max(0, Math.min(180, Number(item.restSeconds) || 60)),
      reps: String(item.reps || "").slice(0, 80),
      note: String(item.note || "").slice(0, 100),
      completed: Boolean(item.completed)
    };
  });

  const totalSets = Number(totals.totalSets);
  const completedSets = Number(totals.completedSets);

  if (!Number.isFinite(totalSets) || totalSets <= 0 || !Number.isFinite(completedSets)) {
    throw new Error("Workout session totals are invalid.");
  }

  return {
    title: String(raw.title || "Workout session").slice(0, 120),
    focus: String(raw.focus || "").slice(0, 120),
    currentWeight: Number(raw.currentWeight) || 0,
    totals: {
      completedSets,
      totalSets,
      completedExercises: Number(totals.completedExercises) || 0,
      totalExercises: Number(totals.totalExercises) || parsedExercises.length,
      completionPercent: Number(totals.completionPercent) || 0
    },
    exercises: parsedExercises
  };
}

function normalizeSessionScore(score: number, completionPercent: number) {
  let normalized = Math.max(0, Math.min(10, score));

  if (completionPercent < 25) normalized = Math.min(normalized, 4);
  else if (completionPercent < 50) normalized = Math.min(normalized, 6);
  else if (completionPercent < 80) normalized = Math.min(normalized, 8);

  return Math.round(normalized * 10) / 10;
}

function estimateSessionCalories(session: SessionPayload) {
  const weight = session.currentWeight > 0 ? session.currentWeight : 80;
  const completedSets = Math.max(0, session.totals.completedSets);
  const weightedRestTotal = session.exercises.reduce(
    (sum, exercise) => sum + exercise.completedSets * exercise.restSeconds,
    0
  );
  const averageRestSeconds = completedSets > 0 ? weightedRestTotal / completedSets : 60;
  const minutes = completedSets * (0.75 + Math.min(averageRestSeconds, 120) / 60);
  const kcalPerMinute = (4.3 * 3.5 * weight) / 200;
  const kcal = Math.round(minutes * kcalPerMinute);

  return {
    kcal,
    low: Math.max(1, Math.round(kcal * 0.75)),
    high: Math.max(1, Math.round(kcal * 1.3))
  };
}

function parseStringList(value: unknown, maxItems = 4) {
  return Array.isArray(value)
    ? value.map((item) => String(item).slice(0, 180)).slice(0, maxItems)
    : [];
}

function parseSessionAnalysisJson(text: string, session: SessionPayload): SessionAnalysis {
  const parsed = JSON.parse(text.trim()) as Partial<SessionAnalysis>;
  const calorieFallback = estimateSessionCalories(session);
  const calories = (parsed.estimatedCaloriesBurned || {}) as Partial<
    SessionAnalysis["estimatedCaloriesBurned"]
  >;
  const rawKcal = Math.round(Number(calories.kcal) || calorieFallback.kcal);
  const boundedKcal = Math.max(
    calorieFallback.low,
    Math.min(calorieFallback.high, rawKcal)
  );
  const fullAnalysis = (parsed.fullAnalysis || {}) as Partial<
    SessionAnalysis["fullAnalysis"]
  >;

  return {
    summary: String(parsed.summary || "تم تحليل الحصة.").slice(0, 220),
    score: normalizeSessionScore(Number(parsed.score) || 0, session.totals.completionPercent),
    estimatedCaloriesBurned: {
      kcal: boundedKcal,
      low: calorieFallback.low,
      high: calorieFallback.high,
      basis: String(calories.basis || "تقدير تقريبي حسب الوزن وعدد المجموعات المنفذة.").slice(0, 220)
    },
    fullAnalysis: {
      adherence: String(fullAnalysis.adherence || "").slice(0, 260),
      volume: String(fullAnalysis.volume || "").slice(0, 260),
      intensity: String(fullAnalysis.intensity || "").slice(0, 260),
      muscleBalance: String(fullAnalysis.muscleBalance || "").slice(0, 260),
      recovery: String(fullAnalysis.recovery || "").slice(0, 260),
      progression: String(fullAnalysis.progression || "").slice(0, 260)
    },
    positives: parseStringList(parsed.positives, 4),
    cautions: parseStringList(parsed.cautions, 4),
    nextFocus: parseStringList(parsed.nextFocus, 4)
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
    const model = validateModel(body.model);

    if (body.type === "session_analysis") {
      const session = validateSessionPayload(body.session);
      const prompt = [
        "You are a practical Arabic fitness coach reviewing one resistance-training session.",
        "Analyze the session from completed sets versus planned sets. Do not invent injury or medical claims.",
        "The score is an adherence score from 0 to 10 based mainly on completed sets. If completion is under 25%, score must be 4 or lower. If under 50%, score must be 6 or lower. If under 80%, score must be 8 or lower.",
        "Return Arabic JSON only using the requested schema. Keep advice detailed enough to be useful but concise per field.",
        "Include estimatedCaloriesBurned as kcal, low, high, and basis. Base calories on completed sets, current weight, rest times, and moderate resistance-training effort. Make it clear this is an estimate, not a wearable measurement.",
        "Include fullAnalysis with adherence, volume, intensity, muscleBalance, recovery, and progression. Explain what happened and what to do next.",
        `Session data: ${JSON.stringify(session)}`
      ].join("\n");

      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  summary: { type: "STRING" },
                  score: { type: "NUMBER" },
                  estimatedCaloriesBurned: {
                    type: "OBJECT",
                    properties: {
                      kcal: { type: "NUMBER" },
                      low: { type: "NUMBER" },
                      high: { type: "NUMBER" },
                      basis: { type: "STRING" }
                    },
                    required: ["kcal", "low", "high", "basis"]
                  },
                  fullAnalysis: {
                    type: "OBJECT",
                    properties: {
                      adherence: { type: "STRING" },
                      volume: { type: "STRING" },
                      intensity: { type: "STRING" },
                      muscleBalance: { type: "STRING" },
                      recovery: { type: "STRING" },
                      progression: { type: "STRING" }
                    },
                    required: [
                      "adherence",
                      "volume",
                      "intensity",
                      "muscleBalance",
                      "recovery",
                      "progression"
                    ]
                  },
                  positives: { type: "ARRAY", items: { type: "STRING" } },
                  cautions: { type: "ARRAY", items: { type: "STRING" } },
                  nextFocus: { type: "ARRAY", items: { type: "STRING" } }
                },
                required: [
                  "summary",
                  "score",
                  "estimatedCaloriesBurned",
                  "fullAnalysis",
                  "positives",
                  "cautions",
                  "nextFocus"
                ]
              }
            }
          })
        }
      );

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        console.error("Gemini session analysis failed", {
          status: geminiResponse.status,
          errorText: errorText.slice(0, 500)
        });

        return jsonResponse({ error: "Gemini session analysis failed." }, 502, origin);
      }

      const geminiJson = await geminiResponse.json();
      const resultText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;

      if (typeof resultText !== "string") {
        return jsonResponse({ error: "Gemini returned an unexpected response." }, 502, origin);
      }

      return jsonResponse(
        parseSessionAnalysisJson(resultText, session),
        200,
        origin
      );
    }

    const base64Data = String(body.base64Data || "");
    const mimeType = String(body.mimeType || "");

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
