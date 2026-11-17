import React, { createContext, useContext, useEffect, useState } from "react";

export type Lang = "en" | "th";

export const dictionaries: Record<Lang, Record<string, string>> = {
  en: {},
  th: {
    "TIKTOK LIVE CONFIGURATION": "การตั้งค่า TikTok",
    "ENDPOINT SETTINGS": "การตั้งค่าปลายทาง",
    "TIKTOK USERNAME": "ชื่อผู้ใช้ TikTok",
    "Username of the TikTok account currently broadcasting live.": "ชื่อผู้ใช้ TikTok ที่กำลังไลฟ์สดอยู่",
    "TIKTOK GIFT WEBHOOK (event: \"gift\")": "เว็บฮุคของขวัญ TikTok (event: \"gift\")",
    "TIKTOK CHAT / TTS WEBHOOK (event: \"tts\")": "เว็บฮุคแชท / TTS (event: \"tts\")",
    "SPOTIFY WEBHOOK (event: \"spotify\")": "เว็บฮุค Spotify (event: \"spotify\")",
    "Endpoint that receives HTTP POST requests when gifts are sent.": "ปลายทางที่รับคำขอ HTTP POST เมื่อมีของขวัญ",
    "Receives chat messages when TTS/chat webhook is enabled. Empty falls back to gift webhook.": "รับข้อความแชทเมื่อเปิดเว็บฮุคแชท/TTS เว้นว่างจะใช้เว็บฮุคของขวัญแทน",
    "Receives song-change events. Empty falls back to gift webhook.": "รับเหตุการณ์เพลงเปลี่ยน เว้นว่างจะใช้เว็บฮุคของขวัญแทน",
    "SAVE CONFIG": "บันทึกการตั้งค่า",
    "DISCONNECT STREAM": "ตัดการเชื่อมต่อสตรีม",
    "SAVE & CONNECT": "บันทึกและเชื่อมต่อ",
    "CONNECTING...": "กำลังเชื่อมต่อ...",
    "SEND TEST WEBHOOK": "ส่งเว็บฮุคทดสอบ",
    "SENDING...": "กำลังส่ง...",
    "SPOTIFY INTEGRATION": "การเชื่อมต่อ Spotify",
    "DASHBOARD": "แดชบอร์ด",
    "CONFIGURATION": "การตั้งค่า",
    "OVERLAYS": "โอเวอร์เลย์",
    "OVERLAY STUDIO": "สตูดิโอโอเวอร์เลย์",
    "ABOUT": "เกี่ยวกับ",
    "SYSTEM STATUS": "สถานะระบบ",
    "BRIDGE: ONLINE": "บริดจ์: ออนไลน์",
    "BRIDGE: OFFLINE": "บริดจ์: ออฟไลน์",
    "TIKTOK: DISCONNECTED": "TikTok: ตัดการเชื่อมต่อ",
    "TIKTOK: CONNECTING": "TikTok: กำลังเชื่อมต่อ",
    "TIKTOK: CONNECTED": "TikTok: เชื่อมต่อแล้ว",
    "TIKTOK: ERROR": "TikTok: ข้อผิดพลาด",
    "SPOTIFY: OFF": "Spotify: ปิด",
    "SPOTIFY: IDLE": "Spotify: ว่าง",
    "SPOTIFY: PLAYING": "Spotify: กำลังเล่น",
    "SPOTIFY: ERROR": "Spotify: ข้อผิดพลาด",
    "ABOUT // donate-socket": "เกี่ยวกับ // donate-socket",
    "APP VERSION": "เวอร์ชันแอป",
    "UPDATE STATUS": "สถานะอัปเดต",
    "CHECK FOR UPDATES": "ตรวจสอบอัปเดต",
    "CHECKING...": "กำลังตรวจสอบ...",
    "UP TO DATE (latest: {v})": "อัปเดตล่าสุดแล้ว ({v})",
    "UPDATE AVAILABLE: {tag}": "มีเวอร์ชันใหม่: {tag}",
    "CHECK FAILED: {err}": "ตรวจสอบล้มเหลว: {err}",
    "NOT CHECKED": "ยังไม่ตรวจสอบ",
    "WEBHOOK DISPATCH LOGS": "บันทึกการส่งเว็บฮุค",
    "ALL": "ทั้งหมด",
    "GIFT": "ของขวัญ",
    "TTS": "แชท/TTS",
    "SPOTIFY": "เพลง",
    "CLEAR LOGS": "ล้างบันทึก",
    "NO DISPATCHES RECORDED YET": "ยังไม่มีบันทึกการส่ง",
    "LIVE: {room}": "สด: {room}",
  },
};

// Keys missing in th fall back to the English source text (same key).
export const tFor = (lang: Lang, key: string): string => dictionaries[lang][key] ?? key;

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const Ctx = createContext<LangCtx>({ lang: "en", setLang: () => {}, t: (k) => k });

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return (localStorage.getItem("donate_socket_lang") as Lang) || "en";
    } catch {
      return "en";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("donate_socket_lang", lang);
    } catch {}
  }, [lang]);

  const t = (key: string) => tFor(lang, key);
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useLang = () => useContext(Ctx);