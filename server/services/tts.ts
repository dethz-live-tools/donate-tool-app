import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

export interface TtsVoice {
  name: string;
  shortName: string;
  gender: string;
  locale: string;
  friendlyName: string;
  suggested?: boolean;
}

export interface SynthesizeOptions {
  text: string;
  voice?: string;
  rate?: number | string; // e.g. 1.0 or "+0%"
  pitch?: number | string; // e.g. 1.0 or "+0Hz"
  volume?: number | string;
}

const DEFAULT_VOICE = "th-TH-NiwatNeural";
const SECONDARY_THAI_VOICE = "th-TH-PremwadeeNeural";

// LRU audio cache to avoid re-synthesizing repeated phrases
const AUDIO_CACHE = new Map<string, Buffer>();
const MAX_CACHE_SIZE = 200;

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&"\x27]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return c;
    }
  });
}

function cleanText(text: string): string {
  return text
    .split("")
    .map((c) => {
      const code = c.charCodeAt(0);
      if (
        (code >= 0 && code <= 8) ||
        (code >= 11 && code <= 12) ||
        (code >= 14 && code <= 31)
      ) {
        return " ";
      }
      return c;
    })
    .join("");
}

function formatRate(rate?: number | string): string {
  if (typeof rate === "string" && (rate.endsWith("%") || rate === "default")) {
    return rate;
  }
  const num = typeof rate === "number" ? rate : parseFloat(String(rate));
  if (isNaN(num) || Math.abs(num - 1.0) < 0.05) return "+0%";
  const pct = Math.round((num - 1.0) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function formatPitch(pitch?: number | string): string {
  if (typeof pitch === "string" && (pitch.endsWith("Hz") || pitch.endsWith("st"))) {
    return pitch;
  }
  const num = typeof pitch === "number" ? pitch : parseFloat(String(pitch));
  if (isNaN(num) || Math.abs(num - 1.0) < 0.05) return "+0Hz";
  const hz = Math.round((num - 1.0) * 50);
  return `${hz >= 0 ? "+" : ""}${hz}Hz`;
}

function buildSSML(text: string, voice: string, rate: string, pitch: string): string {
  const cleaned = escapeXml(cleanText(text));
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` +
    `<voice name="${voice}">` +
    `<prosody pitch="${pitch}" rate="${rate}" volume="+0%">` +
    cleaned +
    `</prosody></voice></speak>`;
}

let cachedVoicesList: TtsVoice[] | null = null;

export async function getTtsVoices(): Promise<TtsVoice[]> {
  if (cachedVoicesList && cachedVoicesList.length > 0) {
    return cachedVoicesList;
  }

  const priorityVoices: TtsVoice[] = [
    {
      name: "Microsoft Niwat Online (Natural) - Thai (Thailand)",
      shortName: "th-TH-NiwatNeural",
      gender: "Male",
      locale: "th-TH",
      friendlyName: "Thai Male (Niwat - Natural)",
      suggested: true,
    },
    {
      name: "Microsoft Premwadee Online (Natural) - Thai (Thailand)",
      shortName: "th-TH-PremwadeeNeural",
      gender: "Female",
      locale: "th-TH",
      friendlyName: "Thai Female (Premwadee - Natural)",
      suggested: true,
    },
    {
      name: "Microsoft Aria Online (Natural) - English (United States)",
      shortName: "en-US-AriaNeural",
      gender: "Female",
      locale: "en-US",
      friendlyName: "English Female (Aria - Natural)",
      suggested: false,
    },
    {
      name: "Microsoft Guy Online (Natural) - English (United States)",
      shortName: "en-US-GuyNeural",
      gender: "Male",
      locale: "en-US",
      friendlyName: "English Male (Guy - Natural)",
      suggested: false,
    },
    {
      name: "Microsoft Jenny Online (Natural) - English (United States)",
      shortName: "en-US-JennyNeural",
      gender: "Female",
      locale: "en-US",
      friendlyName: "English Female (Jenny - Natural)",
      suggested: false,
    },
  ];

  try {
    const tts = new MsEdgeTTS();
    const rawVoices = await tts.getVoices();
    const thaiList: TtsVoice[] = [];
    const otherList: TtsVoice[] = [];

    for (const v of rawVoices) {
      const isPriority = priorityVoices.some((p) => p.shortName === v.ShortName);
      if (isPriority) continue;

      const item: TtsVoice = {
        name: v.Name,
        shortName: v.ShortName,
        gender: v.Gender,
        locale: v.Locale,
        friendlyName: `${v.FriendlyName || v.ShortName} (${v.Gender})`,
        suggested: false,
      };

      if (v.Locale.startsWith("th") || v.ShortName.startsWith("th")) {
        thaiList.push(item);
      } else if (v.Locale.startsWith("en")) {
        otherList.push(item);
      }
    }

    cachedVoicesList = [...priorityVoices, ...thaiList, ...otherList];
    return cachedVoicesList;
  } catch (err) {
    console.warn("[TTS] Failed to fetch remote Edge TTS voices, using defaults:", err);
    cachedVoicesList = priorityVoices;
    return cachedVoicesList;
  }
}

async function runSynthesisOnce(
  ssml: string,
  voiceName: string
): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  return new Promise((resolve, reject) => {
    const { audioStream } = tts.rawToStream(ssml);
    const chunks: Buffer[] = [];

    audioStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    audioStream.on("end", () => {
      tts.close();
      const full = Buffer.concat(chunks);
      if (full.length === 0) {
        reject(new Error("No audio bytes received from Edge TTS"));
      } else {
        resolve(full);
      }
    });
    audioStream.on("error", (err: Error) => {
      tts.close();
      reject(err);
    });
  });
}

export async function synthesizeEdgeTTS(options: SynthesizeOptions): Promise<Buffer> {
  const text = (options.text || "").trim();
  if (!text) {
    throw new Error("Text is required for TTS synthesis");
  }

  const voice = options.voice || DEFAULT_VOICE;
  const rateStr = formatRate(options.rate);
  const pitchStr = formatPitch(options.pitch);

  const cacheKey = `${voice}|${rateStr}|${pitchStr}|${text}`;
  if (AUDIO_CACHE.has(cacheKey)) {
    return AUDIO_CACHE.get(cacheKey)!;
  }

  const voicesToTry = [voice];
  // If user selected Premwadee and it fails on male/tonal particles, fallback to Niwat
  if (voice === SECONDARY_THAI_VOICE && !voicesToTry.includes(DEFAULT_VOICE)) {
    voicesToTry.push(DEFAULT_VOICE);
  }

  let lastError: Error | null = null;
  for (const v of voicesToTry) {
    try {
      const ssml = buildSSML(text, v, rateStr, pitchStr);
      const audioBuffer = await runSynthesisOnce(ssml, v);

      if (AUDIO_CACHE.size >= MAX_CACHE_SIZE) {
        const firstKey = AUDIO_CACHE.keys().next().value;
        if (firstKey) AUDIO_CACHE.delete(firstKey);
      }
      AUDIO_CACHE.set(cacheKey, audioBuffer);
      return audioBuffer;
    } catch (err: any) {
      lastError = err;
      console.warn(`[TTS] Edge synthesis error for voice ${v}:`, err?.message || err);
    }
  }

  throw lastError || new Error("Edge TTS synthesis failed");
}
