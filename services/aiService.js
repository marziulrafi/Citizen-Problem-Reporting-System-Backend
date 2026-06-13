const { GoogleGenerativeAI } = require("@google/generative-ai");

const VALID_CATEGORIES = [
  "road_transportation",
  "water_sanitation",
  "electricity",
  "waste_management",
  "public_safety",
  "environmental",
  "other",
];

const VALID_PRIORITIES = ["emergency", "high", "medium", "low"];

const SPAM_THRESHOLD = 0.7;
const MAX_SUMMARY_LEN = 160;

const CIVIC_KEYWORDS =
  /\b(road|street|lane|water|drain|garbage|waste|trash|electric|power|light|pole|pipe|leak|flood|hole|pothole|traffic|accident|danger|unsafe|broken|damage|sewage|toilet|mosquito|pollution|tree|park|building|house|resident|ward|area|block|footpath|sidewalk|signal|bus|vehicle|injur|fire|smoke|noise|smell|overflow|blocked|collapse|crime|theft|harass|bribe|corruption|municipal|civic|complaint|problem|issue|repair|fix|urgent|emergency)\b/i;

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "is", "are", "was", "were",
  "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "may", "might", "must", "shall", "can", "need", "that", "this", "with", "from", "into", "about", "there",
  "their", "they", "your", "my", "our", "very", "also", "just", "please",
]);

const normalizeText = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenizeMeaningful = (text) =>
  normalizeText(text)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

const wordOverlapRatio = (a, b) => {
  const setA = new Set(tokenizeMeaningful(a));
  const setB = new Set(tokenizeMeaningful(b));
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter += 1;
  const union = setA.size + setB.size - inter;
  return union ? inter / union : 0;
};

const isSummaryTooSimilar = (summary, description, title = "") => {
  const s = normalizeText(summary);
  const d = normalizeText(description);
  if (!s || !d) return true;
  if (s === d || (d.includes(s) && s.length >= d.length * 0.5)) return true;
  if (title && s === normalizeText(title)) return true;
  if (wordOverlapRatio(summary, description) >= 0.55) return true;
  if (s.length >= d.length * 0.8) return true;
  return false;
};

const buildHeuristicSummary = (title, description) => {
  const clean = String(description || "").replace(/\s+/g, " ").trim();
  const topic = inferCategoryFromText(clean) || "other";
  const impact = inferImpactPhrase(clean, topic);
  const locationHint = /\bnear\b|\bat\b|\bon\b|\bin\b/i.test(clean) ? " at reported location" : "";
  let out = impact || buildCompressedNote(title, clean);
  if (out.length > MAX_SUMMARY_LEN) out = `${out.slice(0, MAX_SUMMARY_LEN - 1).trim()}…`;
  if (!/[.!?]$/.test(out)) out += ".";
  return out;
};

const buildCompressedNote = (title, description) => {
  const words = tokenizeMeaningful(description);
  const key = words.slice(0, 14).join(" ");
  const prefix = title ? `${String(title).trim().replace(/\.$/, "")}: ` : "Reported issue: ";
  return `${prefix}${key}`.trim();
};

const inferImpactPhrase = (text, category) => {
  const t = normalizeText(text);
  const map = {
    road_transportation: "Road surface defect creating traffic and safety risk",
    water_sanitation: "Water or drainage failure affecting local access and hygiene",
    electricity: "Electrical utility fault posing service disruption or hazard",
    waste_management: "Waste accumulation creating sanitation and nuisance impact",
    public_safety: "Public safety concern requiring municipal intervention",
    environmental: "Environmental hazard affecting community wellbeing",
    other: "Civic infrastructure concern requiring municipal review",
  };
  if (/\b(accident|injur|death|collapse|fire|gas)\b/i.test(text)) {
    return "Serious safety incident requiring urgent municipal response";
  }
  if (/\b(flood|waterlog|overflow|blocked drain)\b/i.test(text)) {
    return "Waterlogging or drainage failure impacting residents and movement";
  }
  return map[category] || map.other;
};

const inferCategoryFromText = (text) => {
  const t = normalizeText(text);
  if (/\b(road|pothole|street|traffic|footpath|bridge|highway)\b/.test(t)) return "road_transportation";
  if (/\b(water|drain|sewage|sanitation|toilet|flood|pipe|leak)\b/.test(t)) return "water_sanitation";
  if (/\b(electric|power|wire|transformer|streetlight|light pole)\b/.test(t)) return "electricity";
  if (/\b(garbage|waste|trash|dump|litter)\b/.test(t)) return "waste_management";
  if (/\b(crime|theft|harass|unsafe|accident|fire|violence)\b/.test(t)) return "public_safety";
  if (/\b(pollution|tree|park|mosquito|smell|environment)\b/.test(t)) return "environmental";
  return "";
};

const inferPriorityFromText = (text) => {
  const t = normalizeText(text);
  if (/\b(emergency|urgent|danger|fire|explosion|collapse|electrocut|gas leak|severe|critical|death)\b/.test(t)) {
    return "emergency";
  }
  if (/\b(unsafe|hazard|injur|flood|blocked|overflow|accident|violence)\b/.test(t)) {
    return "high";
  }
  if (/\b(minor|small|slight|cosmetic)\b/.test(t)) {
    return "low";
  }
  return "medium";
};

/** Normalize spam score to 0–1 (accepts legacy 0–100). */
const normalizeSpamScore = (value) => {
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  if (n > 1) return Math.min(1, Math.round((n / 100) * 100) / 100);
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
};

const COMMON_TRIGRAMS = new Set([
  "the", "and", "ing", "tion", "tha", "ent", "ion", "tio", "for", "ere", "ate", "ver", "con", "pro", "ect",
  "road", "ater", "ter", "men", "est", "ive", "ous", "ght", "igh", "oug", "all", "ear", "her", "not",
]);

const isGibberishToken = (word) => {
  const w = String(word || "").toLowerCase().replace(/[^a-z]/g, "");
  if (w.length < 6) return false;
  if (CIVIC_KEYWORDS.test(w)) return false;

  let triHits = 0;
  for (let i = 0; i <= w.length - 3; i++) {
    if (COMMON_TRIGRAMS.has(w.slice(i, i + 3))) triHits += 1;
  }
  if (triHits >= 2) return false;

  const consonantRuns = w.match(/[bcdfghjklmnpqrstvwxyz]{5,}/g) || [];
  const maxRun = consonantRuns.reduce((m, s) => Math.max(m, s.length), 0);

  if (w.length >= 10 && triHits === 0) return true;
  if (maxRun >= 5) return true;
  if (w.length >= 8 && triHits === 0 && maxRun >= 4) return true;
  return false;
};

const detectHeuristicSpam = (description) => {
  const text = String(description || "").trim();
  if (text.length < 15) {
    return { spamScore: 0, isLikelySpam: false, spamReason: "" };
  }

  const letters = text.replace(/[^a-zA-Z]/g, "");
  const words = text.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  const reasons = [];
  let score = 0;

  if (letters.length < 12) {
    return { spamScore: 0.3, isLikelySpam: false, spamReason: "Very short text" };
  }

  const gibberishWords = words.filter((w) => isGibberishToken(w));
  const gibberishRatio = words.length ? gibberishWords.length / words.length : 0;

  if (gibberishRatio >= 0.66 && words.length >= 2) {
    score = 0.98;
    reasons.push("Nonsensical and unreadable text with no semantic meaning");
  } else if (gibberishRatio >= 0.4) {
    score += 0.75;
    reasons.push("Multiple meaningless word-like tokens detected");
  }

  if (/(.)\1{5,}/.test(text)) {
    score += 0.25;
    reasons.push("Excessive repeated characters");
  }

  if (text.length > 35 && !CIVIC_KEYWORDS.test(text) && gibberishRatio > 0.3) {
    score += 0.2;
    reasons.push("No recognizable civic issue vocabulary");
  }

  if (/^(test|asdf|qwerty|lorem|xxx|spam|fake|dummy)\b/i.test(text)) {
    score = Math.max(score, 0.9);
    reasons.push("Test or placeholder phrasing detected");
  }

  const consonantClusters = (text.match(/[bcdfghjklmnpqrstvwxyz]{6,}/gi) || []).length;
  if (consonantClusters >= 2 && !CIVIC_KEYWORDS.test(text)) {
    score = Math.max(score, 0.85);
    if (!reasons.length) reasons.push("Repeated consonant clusters typical of keyboard spam");
  }

  score = Math.min(1, score);
  const spamScore = Math.round(score * 100) / 100;
  const isLikelySpam = spamScore >= SPAM_THRESHOLD;

  return {
    spamScore,
    isLikelySpam,
    spamReason: isLikelySpam
      ? reasons.slice(0, 2).join("; ") || "Text appears meaningless or automated"
      : "",
  };
};

const mergeSpamSignals = (heuristic, aiSpam) => {
  const spamScore = Math.max(heuristic.spamScore, aiSpam.spamScore);
  const isLikelySpam = heuristic.isLikelySpam || aiSpam.isLikelySpam || spamScore >= SPAM_THRESHOLD;
  const spamReason =
    spamScore >= heuristic.spamScore && aiSpam.spamReason
      ? aiSpam.spamReason
      : heuristic.spamReason || aiSpam.spamReason || "";
  return { spamScore, isLikelySpam, spamReason };
};

const fallbackAnalysis = (title = "", description = "") => {
  const desc = String(description || "").trim();
  const heuristicSpam = detectHeuristicSpam(desc);
  const category = inferCategoryFromText(desc);
  const priority = inferPriorityFromText(desc);

  return {
    isLikelySpam: heuristicSpam.isLikelySpam,
    spamScore: heuristicSpam.spamScore,
    spamReason: heuristicSpam.spamReason,
    aiCategory: heuristicSpam.isLikelySpam ? "" : category,
    aiPriority: heuristicSpam.isLikelySpam ? "low" : priority,
    aiSummary: heuristicSpam.isLikelySpam ? "" : desc.length >= 20 ? buildHeuristicSummary(title, desc) : "",
    aiEnabled: false,
  };
};

const parseJsonFromText = (text) => {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
};

const refineSummary = (summary, title, description) => {
  let s = String(summary || "").trim().replace(/\s+/g, " ");
  if (!s) return buildHeuristicSummary(title, description);
  if (s.length > MAX_SUMMARY_LEN) s = `${s.slice(0, MAX_SUMMARY_LEN - 1).trim()}…`;
  if (isSummaryTooSimilar(s, description, title)) {
    return buildHeuristicSummary(title, description);
  }
  if (!/[.!?]$/.test(s)) s += ".";
  return s;
};

const normalizeAnalysis = (parsed, title, description) => {
  const heuristicSpam = detectHeuristicSpam(description);
  const base = fallbackAnalysis(title, description);

  if (!parsed || typeof parsed !== "object") {
    return { ...base, ...mergeSpamSignals(heuristicSpam, base) };
  }

  const rawSpam = normalizeSpamScore(parsed.spamScore ?? parsed.spam_score ?? 0);
  const aiSpam = {
    spamScore: rawSpam,
    isLikelySpam:
      typeof parsed.isLikelySpam === "boolean"
        ? parsed.isLikelySpam
        : typeof parsed.is_likely_spam === "boolean"
          ? parsed.is_likely_spam
          : rawSpam >= SPAM_THRESHOLD,
    spamReason: String(parsed.spamReason ?? parsed.spam_reason ?? "").trim().slice(0, 200),
  };

  const spam = mergeSpamSignals(heuristicSpam, aiSpam);

  let aiCategory = VALID_CATEGORIES.includes(parsed.category) ? parsed.category : "";
  let aiPriority = VALID_PRIORITIES.includes(parsed.priority) ? parsed.priority : base.aiPriority;
  let aiSummary = "";

  if (!spam.isLikelySpam) {
    const rawSummary = parsed.summary ?? parsed.aiSummary ?? "";
    aiSummary = refineSummary(rawSummary, title, description);
    if (!aiCategory) aiCategory = inferCategoryFromText(description);
  } else {
    aiCategory = "";
    aiPriority = "low";
    if (!spam.spamReason && heuristicSpam.spamReason) {
      spam.spamReason = heuristicSpam.spamReason;
    }
  }

  return {
    isLikelySpam: spam.isLikelySpam,
    spamScore: spam.spamScore,
    spamReason: spam.spamReason,
    aiCategory,
    aiPriority,
    aiSummary,
    aiEnabled: true,
  };
};

const buildPrompt = (title, description) =>
  `You are a municipal issue intelligence system for Dhaka, Bangladesh.

Return ONLY one JSON object with EXACTLY these keys:
{
  "isLikelySpam": boolean,
  "spamScore": number,
  "spamReason": string,
  "category": string,
  "priority": string,
  "summary": string
}

SPAM DETECTION (critical):
- spamScore: float from 0.0 to 1.0 (e.g. 0.98 = almost certainly spam)
- Flag isLikelySpam true when spamScore >= 0.7
- Keyboard mash, random letters, no semantic meaning → high spamScore (0.85-1.0)
- spamReason: one short sentence (max 120 chars) explaining why; empty string if not spam
- Normal civic complaints in plain language → spamScore below 0.2

CLASSIFICATION (only when NOT spam):
- category: one of ${JSON.stringify(VALID_CATEGORIES)}
- priority: one of ${JSON.stringify(VALID_PRIORITIES)}
- summary: max 2 lines, max 160 characters, formal case note for authorities
  - MUST describe impact and issue type
  - MUST NOT copy, quote, or closely paraphrase the citizen text
  - If spam, set summary to empty string ""

Priority: emergency=immediate danger; high=significant harm; medium=standard; low=minor

Title: ${title}
Citizen description:
${description}`;

async function analyzeIssue({ title = "", description = "" } = {}) {
  const safeDescription = String(description || "").trim();
  const safeTitle = String(title || "").trim();

  if (safeDescription.length < 20) {
    return fallbackAnalysis(safeTitle, safeDescription);
  }

  const heuristicSpam = detectHeuristicSpam(safeDescription);
  if (heuristicSpam.isLikelySpam && heuristicSpam.spamScore >= 0.75) {
    return {
      isLikelySpam: true,
      spamScore: heuristicSpam.spamScore,
      spamReason: heuristicSpam.spamReason,
      aiCategory: "",
      aiPriority: "low",
      aiSummary: "",
      aiEnabled: true,
    };
  }

  if (!process.env.GEMINI_API_KEY) {
    return fallbackAnalysis(safeTitle, safeDescription);
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      generationConfig: {
        temperature: 0.15,
        topP: 0.85,
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(buildPrompt(safeTitle, safeDescription));
    const text = result?.response?.text?.() || "";
    const parsed = parseJsonFromText(text);
    return normalizeAnalysis(parsed, safeTitle, safeDescription);
  } catch (err) {
    console.error("[AI] analyzeIssue failed:", err.message);
    return fallbackAnalysis(safeTitle, safeDescription);
  }
}

const analyzeIssueDescription = (opts) => analyzeIssue(opts);

module.exports = {
  analyzeIssue,
  analyzeIssueDescription,
  VALID_CATEGORIES,
  VALID_PRIORITIES,
  SPAM_THRESHOLD,
  detectHeuristicSpam,
  buildHeuristicSummary,
  normalizeSpamScore,
};
