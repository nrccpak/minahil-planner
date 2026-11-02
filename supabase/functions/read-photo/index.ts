// Minahil's Planner — reads the homework diary photo and the ticked evening sheet with Gemini,
// and writes a short daily tip. Runs on Supabase Edge Functions; the Gemini key never reaches the phone.
// Secrets: GEMINI_API_KEY (required), GEMINI_MODEL (optional override).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://ejiatkzbqbxclpsigoaf.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_qu1pqpjwKZld-3UrtrvLgA_vrVupMkk"; // public key, used only to check the login
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const MODELS = [Deno.env.get("GEMINI_MODEL"), "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash"]
  .filter((m): m is string => !!m);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SUBJECTS = ["English-R", "English-W", "Urdu-R", "Urdu-W", "Maths", "Gen. Science", "Soc. Studies",
  "Islamic Studies", "Art", "Nazra", "Arabic", "Other"];

async function signedInUser(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.id ?? null;
}

// ---------- prompts and output shapes ----------
function diaryRequest(subjects: string[]) {
  const prompt = `You are reading a photo of a Pakistani 9th-class student's homework diary page (cropped to the homework table).
The page has printed subject rows: ${subjects.join(", ")}.
Handwritten entries are in English or Urdu and are often not aligned exactly with their printed row — match each entry to the nearest printed subject row.
Rules:
- Skip rows that are blank (no homework).
- "text": copy the entry exactly as written. Keep Urdu in Urdu script; never translate or transliterate.
- "subject": one of the printed subjects; use "Other" if unclear.
- Work out the amount: pages, questions or verses. "Ex 3.2 Q1-3" = 3 questions; "p 12-15" = 4 pages; "Q 1, 4, 7" = 3 questions; verses/ayat for Nazra or Arabic. If no amount is written, use type "minutes" with units 20.
- If the entry mentions a test (English "test" or Urdu "ٹیسٹ"), set test=true and type "test" with units 1.
- dueTomorrow=true only if the entry says it is due tomorrow (e.g. "tomorrow", "کل").
- confidence "low" when the handwriting is hard to read or the row match is uncertain.
Return JSON only.`;
  const schema = {
    type: "OBJECT",
    properties: {
      rows: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            subject: { type: "STRING", enum: subjects },
            text: { type: "STRING" },
            type: { type: "STRING", enum: ["pages", "questions", "verses", "test", "minutes"] },
            units: { type: "INTEGER" },
            test: { type: "BOOLEAN" },
            dueTomorrow: { type: "BOOLEAN" },
            confidence: { type: "STRING", enum: ["high", "low"] },
          },
          required: ["subject", "text", "type", "units", "test", "dueTomorrow", "confidence"],
        },
      },
    },
    required: ["rows"],
  };
  return { prompt, schema };
}

function sheetRequest(tasks: { n: number; subject: string; kind: string }[], dateCode: string) {
  const list = tasks.map((t) => `${t.n}. ${t.subject} (${t.kind})`).join("\n");
  const prompt = `You are reading a photo of a printed daily homework sheet that a student ticked by hand.
The sheet's code printed at the top should be ${dateCode}; report the code you actually see.
In the "Feedback" table there is one row per task, in this order:
${list}
For each task, read which box is ticked in each line (a tick, cross, fill or circle counts):
- status: done / partly / notdone
- time: early10 ("Early 10+"), early5 ("Early 5"), ontime ("On time"), plus10 ("+10"), plus20 ("+20"), plus30 ("+30 or more")
- difficulty: easy / ok / hard
- focus: good / average / poor
- reasons (the "If late" line, may be several): understand ("Didn't understand"), toolong ("Too long"), distracted, breaklong ("Break long"), tired, interrupted
- help: true if "Need help" is ticked
Use "none" when nothing is ticked in that line.
In "Once today": read the handwritten Start, Finish and Sleep times as written (e.g. "3:35", "7:10", "10:20"; "" if blank), whether "Free time taken" is ticked, how many of the 8 TV boxes are ticked (0-8), and the "What was hard today?" text exactly as written ("" if blank; keep Urdu in Urdu).
Return JSON only.`;
  const opt = (vals: string[]) => ({ type: "STRING", enum: [...vals, "none"] });
  const schema = {
    type: "OBJECT",
    properties: {
      dateCode: { type: "STRING" },
      tasks: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            n: { type: "INTEGER" },
            status: opt(["done", "partly", "notdone"]),
            time: opt(["early10", "early5", "ontime", "plus10", "plus20", "plus30"]),
            difficulty: opt(["easy", "ok", "hard"]),
            focus: opt(["good", "average", "poor"]),
            reasons: { type: "ARRAY", items: { type: "STRING", enum: ["understand", "toolong", "distracted", "breaklong", "tired", "interrupted"] } },
            help: { type: "BOOLEAN" },
          },
          required: ["n", "status", "time", "difficulty", "focus", "reasons", "help"],
        },
      },
      start: { type: "STRING" },
      finish: { type: "STRING" },
      sleep: { type: "STRING" },
      freeTaken: { type: "BOOLEAN" },
      tvBoxes: { type: "INTEGER" },
      hardNote: { type: "STRING" },
    },
    required: ["dateCode", "tasks", "start", "finish", "sleep", "freeTaken", "tvBoxes", "hardNote"],
  };
  return { prompt, schema };
}

function tipRequest(context: string) {
  const prompt = `You write one short, warm, practical tip for a 9th-class girl for tomorrow's homework session.
Base it only on these facts from her planner (do not invent anything):
${context}
Rules: one or two sentences, under 160 characters, plain simple English, encouraging, specific to the facts. No emojis, no lecturing, no mention of AI.`;
  const schema = { type: "OBJECT", properties: { tip: { type: "STRING" } }, required: ["tip"] };
  return { prompt, schema };
}

// ---------- Gemini ----------
async function askGemini(prompt: string, schema: unknown, image?: { data: string; mime: string }) {
  const parts: unknown[] = [{ text: prompt }];
  if (image) parts.push({ inline_data: { mime_type: image.mime || "image/jpeg", data: image.data } });
  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: schema },
  });
  let lastErr = "";
  for (const model of MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body,
    });
    const text = await r.text();
    if (r.status === 404 || r.status === 400 && /not found|not supported/i.test(text)) { lastErr = `${model}: ${r.status}`; continue; }
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${text.slice(0, 300)}`);
    const out = JSON.parse(text);
    const raw = out?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    if (!raw) throw new Error("Gemini returned no answer" + (out?.promptFeedback ? `: ${JSON.stringify(out.promptFeedback)}` : ""));
    return { model, result: JSON.parse(raw) };
  }
  throw new Error("No Gemini model available (" + lastErr + ")");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  try {
    if (!(await signedInUser(req))) return json({ error: "Please sign in to cloud sync first." }, 401);
    if (!GEMINI_KEY) return json({ error: "The Gemini key is not set up yet (GEMINI_API_KEY)." }, 500);
    const b = await req.json();
    if (b.mode === "diary") {
      if (!b.image) return json({ error: "No photo sent." }, 400);
      const subjects = Array.isArray(b.subjects) && b.subjects.length ? b.subjects : SUBJECTS;
      const { prompt, schema } = diaryRequest(subjects);
      return json(await askGemini(prompt, schema, { data: b.image, mime: b.mime }));
    }
    if (b.mode === "sheet") {
      if (!b.image) return json({ error: "No photo sent." }, 400);
      const { prompt, schema } = sheetRequest(b.tasks ?? [], String(b.dateCode ?? ""));
      return json(await askGemini(prompt, schema, { data: b.image, mime: b.mime }));
    }
    if (b.mode === "tip") {
      const { prompt, schema } = tipRequest(String(b.context ?? "").slice(0, 2000));
      return json(await askGemini(prompt, schema));
    }
    if (b.mode === "ping") return json({ ok: true, models: MODELS, keySet: !!GEMINI_KEY });
    return json({ error: "Unknown mode" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
