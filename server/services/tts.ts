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

// Verified curated Edge TTS voices list (instant 0ms response)
const CURATED_VOICES: TtsVoice[] = [
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
  {
    name: "Microsoft Christopher Online (Natural) - English (United States)",
    shortName: "en-US-ChristopherNeural",
    gender: "Male",
    locale: "en-US",
    friendlyName: "English Male (Christopher - Natural)",
    suggested: false,
  },
  {
    name: "Microsoft Sonia Online (Natural) - English (United Kingdom)",
    shortName: "en-GB-SoniaNeural",
    gender: "Female",
    locale: "en-GB",
    friendlyName: "English UK Female (Sonia - Natural)",
    suggested: false,
  },
  {
    name: "Microsoft Ryan Online (Natural) - English (United Kingdom)",
    shortName: "en-GB-RyanNeural",
    gender: "Male",
    locale: "en-GB",
    friendlyName: "English UK Male (Ryan - Natural)",
    suggested: false,
  },
  {
    name: "Microsoft Natasha Online (Natural) - English (Australia)",
    shortName: "en-AU-NatashaNeural",
    gender: "Female",
    locale: "en-AU",
    friendlyName: "English AU Female (Natasha - Natural)",
    suggested: false,
  },
  {
    name: "Microsoft WilliamMultilingual Online (Natural) - English (Australia)",
    shortName: "en-AU-WilliamMultilingualNeural",
    gender: "Male",
    locale: "en-AU",
    friendlyName: "English AU Male (William Multilingual)",
    suggested: false,
  },
];

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
  const lang = voice.toLowerCase().startsWith("th") ? "th-TH" : "en-US";
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">` +
    `<voice name="${voice}">` +
    `<prosody pitch="${pitch}" rate="${rate}" volume="+0%">` +
    cleaned +
    `</prosody></voice></speak>`;
}

let cachedVoicesList: TtsVoice[] = [...CURATED_VOICES];

export async function getTtsVoices(): Promise<TtsVoice[]> {
  // Always return curated list immediately without blocking HTTP requests
  return cachedVoicesList;
}

function runSynthesisOnceWithTimeout(
  ssml: string,
  voiceName: string,
  timeoutMs: number = 4000
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    let finished = false;

    // Use fast connection and synthesis timeouts to prevent 60s socket hangs
    const tts = new MsEdgeTTS({ connectionTimeoutMs: 2500, synthesisTimeoutMs: timeoutMs });

    const cleanup = () => {
      finished = true;
      if (timer) clearTimeout(timer);
      try {
        tts.close();
      } catch {}
    };

    timer = setTimeout(() => {
      if (!finished) {
        cleanup();
        reject(new Error(`Edge TTS timeout after ${timeoutMs}ms for ${voiceName}`));
      }
    }, timeoutMs);

    tts
      .setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
      .then(() => {
        if (finished) return;
        const { audioStream } = tts.rawToStream(ssml);
        const chunks: Buffer[] = [];

        audioStream.on("data", (chunk: Buffer) => {
          if (!finished) chunks.push(chunk);
        });

        audioStream.on("end", () => {
          if (finished) return;
          cleanup();
          const full = Buffer.concat(chunks);
          if (full.length === 0) {
            reject(new Error(`No audio bytes received from Edge TTS for voice ${voiceName}`));
          } else {
            resolve(full);
          }
        });

        audioStream.on("error", (err: Error) => {
          if (finished) return;
          cleanup();
          reject(err);
        });
      })
      .catch((err) => {
        if (finished) return;
        cleanup();
        reject(err);
      });
  });
}

export async function synthesizeEdgeTTS(options: SynthesizeOptions): Promise<Buffer> {
  const text = (options.text || "").trim();
  if (!text) {
    throw new Error("Text is required for TTS synthesis");
  }

  const requestedVoice = options.voice || DEFAULT_VOICE;
  const rateStr = formatRate(options.rate);
  const pitchStr = formatPitch(options.pitch);

  const cacheKey = `${requestedVoice}|${rateStr}|${pitchStr}|${text}`;
  if (AUDIO_CACHE.has(cacheKey)) {
    return AUDIO_CACHE.get(cacheKey)!;
  }

  const isThaiText = /[\u0E00-\u0E7F]/.test(text);

  // Build candidate voices list
  const voicesToTry: string[] = [];

  // If text is Thai but selected voice is non-Thai, prioritize Thai male (Niwat)
  if (isThaiText && !requestedVoice.toLowerCase().startsWith("th")) {
    voicesToTry.push(DEFAULT_VOICE);
    if (requestedVoice !== SECONDARY_THAI_VOICE) {
      voicesToTry.push(SECONDARY_THAI_VOICE);
    }
  } else {
    voicesToTry.push(requestedVoice);
    // Always provide Niwat as guaranteed fallback if requested voice fails
    if (requestedVoice !== DEFAULT_VOICE) {
      voicesToTry.push(DEFAULT_VOICE);
    }
    if (requestedVoice !== SECONDARY_THAI_VOICE && !voicesToTry.includes(SECONDARY_THAI_VOICE)) {
      voicesToTry.push(SECONDARY_THAI_VOICE);
    }
  }

  let lastError: Error | null = null;
  for (const v of voicesToTry) {
    try {
      const ssml = buildSSML(text, v, rateStr, pitchStr);
      const audioBuffer = await runSynthesisOnceWithTimeout(ssml, v, 3500);

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
