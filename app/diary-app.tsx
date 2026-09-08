"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  CloudDownload,
  ImagePlus,
  List as ListIcon,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";

type Entry = {
  id: number;
  diaryDate: string;
  daycareReply: string;
  parentMessage: string;
  sourceType: "text" | "ocr";
};

type EntriesResponse = {
  entries: Entry[];
  startDate: string;
  endDate: string;
  previousWeekShift: number | null;
  nextWeekShift: number | null;
};

const PERIOD_CACHE_LIMIT = 12;

function rememberPeriod(
  cache: Map<string, EntriesResponse>,
  key: string,
  value: EntriesResponse
) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > PERIOD_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    cache.delete(oldestKey);
  }
}

const weekday = ["日", "月", "火", "水", "木", "金", "土"];
const offsets = [
  { key: "none", label: "そのまま", months: 0, days: 0 },
  { key: "week", label: "1週間前", months: 0, days: 7 },
  { key: "month", label: "1か月前", months: 1, days: 0 },
  { key: "quarter", label: "3か月前", months: 3, days: 0 },
  { key: "half", label: "半年前", months: 6, days: 0 },
];

function combinedPeriodLabel(yearsAgo: number, offset: (typeof offsets)[number]) {
  if (offset.days === 7) {
    return yearsAgo === 0 ? "1週間前" : `${yearsAgo}年1週間前`;
  }
  const totalMonths = yearsAgo * 12 + offset.months;
  if (totalMonths === 0) return "最近";
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (months === 6) {
    return years === 0 ? "半年前" : `${years}年半前`;
  }
  if (years === 0) return `${months}か月前`;
  if (months === 0) return `${years}年前`;
  return `${years}年${months}か月前`;
}

function localDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function displayDate(value: string, withWeekday = false) {
  const [year, month, day] = value.split("-").map(Number);
  const suffix = withWeekday
    ? `（${weekday[new Date(year, month - 1, day).getDay()]}）`
    : "";
  return `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}${suffix}`;
}

function exportText(entries: Entry[], startDate: string, endDate: string) {
  const lines = [`珀翔diary　${displayDate(startDate)}〜${displayDate(endDate)}`, ""];
  entries.forEach((entry) => {
    lines.push(`【${displayDate(entry.diaryDate, true)}】`);
    lines.push("園からの返事");
    lines.push(entry.daycareReply || "（記録なし）");
    lines.push("");
    lines.push("こちらからの連絡");
    lines.push(entry.parentMessage || "（記録なし）");
    lines.push("");
  });
  return lines.join("\n").trim();
}

function splitRecognizedText(text: string) {
  const normalized = normalizeOcrText(text);
  const marker = normalized.search(
    /(?:園から|保育園から|先生から)(?:の)?(?:返事|返信|連絡)?[：:]?/
  );
  if (marker > 0) {
    return {
      parentMessage: normalized.slice(0, marker).trim(),
      daycareReply: normalized.slice(marker).replace(/^.*?[：:]?\s*/, "").trim(),
    };
  }
  return { parentMessage: "", daycareReply: normalized };
}

function normalizeOcrText(text: string) {
  const meaningfulCharacter = /[0-9A-Za-zぁ-んァ-ヶ一-龠々〆ヵヶー]/u;
  const expressiveCharacter = /[\^＾♪♫♬♡♥☆★☺☻（）()！!？?✨🎵🎶💕💖]/u;
  const japaneseCharacter = "々〆ヵヶぁ-んァ-ヶ一-龠ー";
  const lines = text
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[\t \u3000]+/g, " ").trim())
    .filter((line) => line && (meaningfulCharacter.test(line) || expressiveCharacter.test(line)))
    .map((line) =>
      line
        .replace(new RegExp(`([${japaneseCharacter}])\\s+(?=[${japaneseCharacter}])`, "gu"), "$1")
        .replace(new RegExp(`([${japaneseCharacter}])\\s+(?=[0-9A-Za-z])`, "gu"), "$1")
        .replace(new RegExp(`([0-9A-Za-z])\\s+(?=[${japaneseCharacter}])`, "gu"), "$1")
        .replace(/\s+([、。！？!?）」』】])/g, "$1")
        .replace(/([（「『【])\s+/g, "$1")
    );

  const joined = lines.reduce((paragraph, line) => {
    if (!paragraph) return line;
    const needsSpace = /[0-9A-Za-z]$/u.test(paragraph) && /^[0-9A-Za-z]/u.test(line);
    return `${paragraph}${needsSpace ? " " : ""}${line}`;
  }, "");

  return correctLikelyOcrErrors(joined)
    .replace(/\s+([、。！？!?）」』】])/g, "$1")
    .replace(/([（「『【])\s+/g, "$1")
    .replace(/先生より\s*/g, "先生より\n")
    .replace(/[ \t\u3000]{2,}/g, " ")
    .trim();
}

function correctLikelyOcrErrors(text: string) {
  return text
    .replace(/カラ[ー一]/g, "カラー")
    .replace(/(?:ホ|ボ|ポ){2,4}ール/g, "ボール")
    .replace(/パ[ー一]テ[ー一]シ[ョヨ]ン/g, "パーテーション")
    .replace(/[人入]\s*笑\s*[)）]/g, "(笑)")
    .replace(/[（(]\s*笑\s*[)）]/g, "(笑)")
    .replace(/(です(?:ね|よ))笑(?=(?:今日|明日|昨日|今朝|今回は))/g, "$1＾＾笑")
    .replace(/([々〆ヵヶぁ-んァ-ヶ一-龠ー])!(?=[々〆ヵヶぁ-んァ-ヶ一-龠ー])/gu, "$1！")
    .replace(/([々〆ヵヶぁ-んァ-ヶ一-龠ー])\?(?=[々〆ヵヶぁ-んァ-ヶ一-龠ー])/gu, "$1？")
    .replace(/です(?:り)?\s*\+?[}］】』]\s*$/u, "です♪")
    .replace(/\+?[}］】』]\s*$/u, "♪");
}

function ocrCandidateScore(text: string, confidence: number) {
  const normalized = normalizeOcrText(text);
  const meaningfulLength = (normalized.match(/[0-9A-Za-zぁ-んァ-ヶ一-龠々ー]/gu) ?? []).length;
  const suspiciousCharacters = (normalized.match(/[�□■◆◇|¦]/g) ?? []).length;
  const repeatedNoise = (normalized.match(/([ぁ-んァ-ヶ一-龠])\1{3,}/gu) ?? []).length;
  const expressiveSymbols = (text.match(/[\^＾♪♫♬♡♥☆★☺☻（）()！!？?✨🎵🎶💕💖]/gu) ?? []).length;
  const brokenExpression = (text.match(/[人入]\s*笑\s*[)）]/gu) ?? []).length;
  const trailingBrace = /\+?[}］】』]\s*$/u.test(text) ? 1 : 0;
  return confidence + Math.min(8, meaningfulLength / 40) + Math.min(5, expressiveSymbols) -
    suspiciousCharacters * 5 - repeatedNoise * 3 - brokenExpression * 4 - trailingBrace * 3;
}

async function preprocessImage(file: File) {
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("画像を開けませんでした。"));
      element.src = imageUrl;
    });
    const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(2, 2400 / Math.max(longestSide, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("画像を処理できませんでした。");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const gray =
        pixels.data[index] * 0.299 +
        pixels.data[index + 1] * 0.587 +
        pixels.data[index + 2] * 0.114;
      const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
      pixels.data[index] = contrasted;
      pixels.data[index + 1] = contrasted;
      pixels.data[index + 2] = contrasted;
    }
    context.putImageData(pixels, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("画像を処理できませんでした。")),
        "image/jpeg",
        0.94
      )
    );
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function childFocusedSentences(entry: Entry) {
  const text = normalizeOcrText(entry.daycareReply)
    .replace(/(?:^|\n)[^\n。！？!?]{0,100}先生より\n?/gu, "")
    .replace(/[^\s、。！？!?\n]{1,16}先生(?:より|から)?/gu, "")
    .replace(/[ \t\u3000]{2,}/g, " ")
    .trim();
  const sentences = text
    .match(/[^。！？!?\n]+[。！？!?]?/gu)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? [];
  const childOnly = sentences.filter((sentence) =>
    !/(?:お母さま|お母さん|お父さま|お父さん|ママ|パパ|保護者|ご家庭|おうちで|先生)/u.test(sentence) &&
    !/^(?:いつも|本日も|今日もよろしく|ありがとうございます|よろしくお願いします)/u.test(sentence)
  );
  return childOnly.length ? childOnly : sentences;
}

function summarizeWeek(entries: Entry[]) {
  const sentencesByEntry = entries
    .map(childFocusedSentences)
    .filter((sentences) => sentences.length);
  const summary: string[] = [];
  let sentenceIndex = 0;
  while (summary.length < 3 && sentencesByEntry.some((sentences) => sentenceIndex < sentences.length)) {
    for (const sentences of sentencesByEntry) {
      const sentence = sentences[sentenceIndex];
      if (sentence && !summary.includes(sentence)) summary.push(sentence);
      if (summary.length === 3) break;
    }
    sentenceIndex += 1;
  }
  return summary;
}

function summarizeDay(entry: Entry) {
  const childSentence = childFocusedSentences(entry)[0];
  if (childSentence) return childSentence;
  const parentSentence = normalizeOcrText(entry.parentMessage)
    .match(/[^。！？!?\n]+[。！？!?]?/u)?.[0]
    ?.trim();
  return parentSentence || "記録があります";
}

export default function DiaryApp() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [verifyingPin, setVerifyingPin] = useState(false);
  const [view, setView] = useState<"memory" | "list">("memory");
  const [yearsAgo, setYearsAgo] = useState("");
  const [availableYearOffsets, setAvailableYearOffsets] = useState<number[]>([]);
  const [yearsLoaded, setYearsLoaded] = useState(false);
  const [offsetKey, setOffsetKey] = useState("none");
  const [weekShift, setWeekShift] = useState(0);
  const [data, setData] = useState<EntriesResponse | null>(null);
  const [allEntries, setAllEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Entry | null>(null);
  const [mode, setMode] = useState<"text" | "ocr">("text");
  const [diaryDate, setDiaryDate] = useState(localDateKey());
  const [daycareReply, setDaycareReply] = useState("");
  const [parentMessage, setParentMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrReady, setOcrReady] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const pinRequest = useRef(false);
  const periodCache = useRef(new Map<string, EntriesResponse>());
  const periodCacheGeneration = useRef(0);
  const pendingPrefetches = useRef(new Set<string>());
  const activePeriodRequest = useRef<AbortController | null>(null);
  const selectedOffset =
    offsets.find((offset) => offset.key === offsetKey) ?? offsets[0];

  const fetchAvailableYears = useCallback(async () => {
    try {
      const response = await fetch("/api/entries?years=1", { cache: "no-store" });
      if (response.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!response.ok) throw new Error("登録年を読み込めませんでした。");
      const result = (await response.json()) as { years: number[] };
      const currentYear = new Date().getFullYear();
      const offsetsFromRecords = [...new Set(
        result.years
          .map((year) => currentYear - year)
          .filter((yearOffset) => yearOffset >= 0)
      )].sort((a, b) => a - b);
      setAvailableYearOffsets(offsetsFromRecords);
      setYearsAgo((current) =>
        current !== "" && offsetsFromRecords.includes(Number(current))
          ? current
          : offsetsFromRecords.length
            ? String(offsetsFromRecords[0])
            : ""
      );
      if (!offsetsFromRecords.length) setData(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "登録年を読み込めませんでした。");
    } finally {
      setYearsLoaded(true);
    }
  }, []);

  const buildPeriodRequest = useCallback((requestedWeekShift: number) => {
    const requestedOffset =
      offsets.find((offset) => offset.key === offsetKey) ?? offsets[0];
    const requestedMonthsAgo =
      (Number(yearsAgo) || 0) * 12 + requestedOffset.months;
    const referenceDate = localDateKey();
    const key = [
      requestedMonthsAgo,
      requestedOffset.days,
      requestedWeekShift,
      referenceDate,
    ].join(":");
    return {
      key,
      url: `/api/entries?monthsAgo=${requestedMonthsAgo}&daysAgo=${requestedOffset.days}&weekShift=${requestedWeekShift}&referenceDate=${referenceDate}`,
    };
  }, [offsetKey, yearsAgo]);

  const prefetchPeriod = useCallback(async (requestedWeekShift: number) => {
    const request = buildPeriodRequest(requestedWeekShift);
    const generation = periodCacheGeneration.current;
    const pendingKey = `${generation}:${request.key}`;
    if (periodCache.current.has(request.key) || pendingPrefetches.current.has(pendingKey)) {
      return;
    }
    pendingPrefetches.current.add(pendingKey);
    try {
      const response = await fetch(request.url, { cache: "no-store" });
      if (response.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!response.ok) return;
      const result = (await response.json()) as EntriesResponse;
      if (periodCacheGeneration.current === generation) {
        rememberPeriod(periodCache.current, request.key, result);
      }
    } catch {
      // 先読みの失敗は通常の画面切り替え時に再取得するため、表示を妨げない。
    } finally {
      pendingPrefetches.current.delete(pendingKey);
    }
  }, [buildPeriodRequest]);

  const fetchPeriodEntries = useCallback(async () => {
    const request = buildPeriodRequest(weekShift);
    const cached = periodCache.current.get(request.key);
    activePeriodRequest.current?.abort();
    const controller = new AbortController();
    activePeriodRequest.current = controller;
    const generation = periodCacheGeneration.current;
    if (cached) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const response = await fetch(request.url, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!response.ok) throw new Error("記録を読み込めませんでした。");
      const result = (await response.json()) as EntriesResponse;
      if (
        activePeriodRequest.current !== controller ||
        periodCacheGeneration.current !== generation
      ) return;
      rememberPeriod(periodCache.current, request.key, result);
      setData(result);
      const adjacentShifts = [result.previousWeekShift, result.nextWeekShift]
        .filter((shift): shift is number => shift != null);
      void Promise.all(adjacentShifts.map((shift) => prefetchPeriod(shift)));
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "記録を読み込めませんでした。");
    } finally {
      if (activePeriodRequest.current === controller) {
        activePeriodRequest.current = null;
        setLoading(false);
      }
    }
  }, [buildPeriodRequest, prefetchPeriod, weekShift]);

  const invalidatePeriodCache = useCallback(() => {
    periodCacheGeneration.current += 1;
    periodCache.current.clear();
    activePeriodRequest.current?.abort();
    activePeriodRequest.current = null;
  }, []);

  const fetchAllEntries = useCallback(async () => {
    setListLoading(true);
    try {
      const response = await fetch("/api/entries?all=1", { cache: "no-store" });
      if (response.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!response.ok) throw new Error("記録一覧を読み込めませんでした。");
      const result = (await response.json()) as { entries: Entry[] };
      setAllEntries([...result.entries].reverse());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "記録一覧を読み込めませんでした。");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { authenticated?: boolean }) =>
        setAuthenticated(Boolean(result.authenticated))
      )
      .catch(() => setAuthenticated(false))
      .finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => () => activePeriodRequest.current?.abort(), []);

  useEffect(() => {
    if (authenticated) queueMicrotask(() => void fetchAvailableYears());
  }, [authenticated, fetchAvailableYears]);

  useEffect(() => {
    if (authenticated && yearsLoaded && yearsAgo) {
      queueMicrotask(() => void fetchPeriodEntries());
    }
  }, [authenticated, fetchPeriodEntries, yearsAgo, yearsLoaded]);

  useEffect(() => {
    if (authenticated && view === "list") {
      queueMicrotask(() => void fetchAllEntries());
    }
  }, [authenticated, fetchAllEntries, view]);

  const verifyPin = useCallback(async (value: string) => {
    if (value.length !== 6 || pinRequest.current) return;
    pinRequest.current = true;
    setVerifyingPin(true);
    setPinError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: value }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setPin("");
        setPinError(result.error ?? "暗証番号が違います。");
        return;
      }
      setAuthenticated(true);
    } catch {
      setPin("");
      setPinError("接続できませんでした。もう一度お試しください。");
    } finally {
      pinRequest.current = false;
      setVerifyingPin(false);
    }
  }, []);

  const handlePin = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setPin(digits);
    setPinError("");
    if (digits.length === 6) void verifyPin(digits);
  };

  const resetForm = () => {
    setEditingEntry(null);
    setDiaryDate(localDateKey());
    setDaycareReply("");
    setParentMessage("");
    setMode("text");
    setSelectedImage(null);
    setOcrReady(false);
    setOcrProgress(0);
  };

  const openNewEntry = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEditEntry = (entry: Entry) => {
    setEditingEntry(entry);
    setDiaryDate(entry.diaryDate);
    setDaycareReply(entry.daycareReply);
    setParentMessage(entry.parentMessage);
    setMode(entry.sourceType);
    setSelectedImage(null);
    setOcrReady(entry.sourceType === "ocr");
    setOcrProgress(0);
    setFormOpen(true);
  };

  const recognizeImage = async () => {
    if (!selectedImage) return;
    setOcrRunning(true);
    setOcrProgress(0);
    let worker: Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>> | null = null;
    try {
      const { createWorker, PSM } = await import("tesseract.js");
      let progressBase = 0;
      let progressSpan = 0.45;
      worker = await createWorker("jpn+eng", 1, {
        logger: (message) => {
          if (typeof message.progress === "number") {
            setOcrProgress(Math.round((progressBase + message.progress * progressSpan) * 100));
          }
        },
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: "0",
        user_defined_dpi: "300",
      });
      const originalResult = await worker.recognize(selectedImage, { rotateAuto: true });
      const candidates = [originalResult];

      progressBase = 0.45;
      progressSpan = 0.35;
      setOcrProgress(45);
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      const symbolResult = await worker.recognize(selectedImage, { rotateAuto: true });
      candidates.push(symbolResult);

      let bestResult = candidates.reduce((best, candidate) =>
        ocrCandidateScore(candidate.data.text, candidate.data.confidence) >
        ocrCandidateScore(best.data.text, best.data.confidence)
          ? candidate
          : best
      );
      const bestText = normalizeOcrText(bestResult.data.text);
      const shouldRetry = bestResult.data.confidence < 88 || bestText.length < 30;
      if (shouldRetry) {
        progressBase = 0.8;
        progressSpan = 0.2;
        setOcrProgress(80);
        const preparedImage = await preprocessImage(selectedImage);
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
        const preparedResult = await worker.recognize(preparedImage, { rotateAuto: true });
        if (
          ocrCandidateScore(preparedResult.data.text, preparedResult.data.confidence) >
          ocrCandidateScore(originalResult.data.text, originalResult.data.confidence)
        ) {
          bestResult = preparedResult;
        }
      }

      setOcrProgress(100);
      const separated = splitRecognizedText(bestResult.data.text);
      setDaycareReply(separated.daycareReply);
      setParentMessage(separated.parentMessage);
      setOcrReady(true);
      toast.success("文字を読み取り、文章を整えました。内容を確認してください。");
    } catch {
      toast.error("文字を読み取れませんでした。別の画像を選ぶか、文字で入力してください。");
    } finally {
      if (worker) await worker.terminate().catch(() => undefined);
      setOcrRunning(false);
    }
  };

  const saveEntry = async (overwrite = false) => {
    setSaving(true);
    try {
      const isEditing = Boolean(editingEntry);
      const response = await fetch("/api/entries", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingEntry?.id,
          diaryDate,
          daycareReply,
          parentMessage,
          sourceType: mode,
          overwrite,
        }),
      });
      const result = (await response.json()) as { error?: string; duplicate?: boolean };
      if (!isEditing && response.status === 409 && result.duplicate) {
        const confirmed = window.confirm(
          "同じ日付の記録があります。現在の内容で上書きしますか？"
        );
        if (confirmed) {
          setSaving(false);
          return void saveEntry(true);
        }
        return;
      }
      if (!response.ok) throw new Error(result.error ?? "保存できませんでした。");
      setFormOpen(false);
      resetForm();
      invalidatePeriodCache();
      toast.success(isEditing ? "変更を保存しました。" : "記録を登録しました。");
      await Promise.all([
        fetchAvailableYears(),
        fetchPeriodEntries(),
        view === "list" ? fetchAllEntries() : Promise.resolve(),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存できませんでした。");
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch("/api/entries", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "削除できませんでした。");
      setDeleteTarget(null);
      invalidatePeriodCache();
      toast.success("記録を削除しました。");
      await Promise.all([fetchAvailableYears(), fetchPeriodEntries(), fetchAllEntries()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "削除できませんでした。");
    } finally {
      setDeleting(false);
    }
  };

  const copyWeek = async () => {
    if (!data?.entries.length) return;
    try {
      await navigator.clipboard.writeText(
        exportText(data.entries, data.startDate, data.endDate)
      );
      toast.success("7日分をコピーしました。LINEなどに貼り付けられます。");
    } catch {
      toast.error("コピーできませんでした。");
    }
  };

  const exportExcel = async () => {
    try {
      const response = await fetch("/api/entries?all=1", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = (await response.json()) as { entries: Entry[] };
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("珀翔diary");
      sheet.columns = [
        { header: "園に預けた日", key: "date", width: 15 },
        { header: "園からの返事", key: "reply", width: 70 },
        { header: "こちらからの連絡", key: "message", width: 70 },
      ];
      result.entries.forEach((entry) =>
        sheet.addRow({
          date: displayDate(entry.diaryDate),
          reply: entry.daycareReply,
          message: entry.parentMessage,
        })
      );
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1C4C72" },
      };
      sheet.eachRow((row) => {
        row.alignment = { vertical: "top", wrapText: true };
      });
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `珀翔diary_バックアップ_${localDateKey().replaceAll("-", "")}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Excelバックアップを作成しました。");
    } catch {
      toast.error("Excelバックアップを作成できませんでした。");
    }
  };

  const dateRange = useMemo(() => {
    if (!data) return "";
    return `${displayDate(data.startDate)} 〜 ${displayDate(data.endDate)}`;
  }, [data]);
  const periodLabel = combinedPeriodLabel(Number(yearsAgo) || 0, selectedOffset);
  const weekSummary = useMemo(() => summarizeWeek(data?.entries ?? []), [data]);

  if (checkingSession) {
    return (
      <main className="lock-screen">
        <LoaderCircle className="size-8 animate-spin text-sky-700" />
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="lock-screen">
        <section className="lock-card" aria-labelledby="lock-title">
          <div className="lock-mark"><LockKeyhole aria-hidden="true" /></div>
          <p className="eyebrow">HAKUTO DIARY</p>
          <h1 id="lock-title">おかえりなさい</h1>
          <p className="lock-help">6桁の暗証番号を入力してください</p>
          <InputOTP
            maxLength={6}
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={handlePin}
            disabled={verifyingPin}
            autoFocus
            aria-label="6桁の暗証番号"
            containerClassName="justify-center"
          >
            <InputOTPGroup className="otp-group">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <InputOTPSlot key={index} index={index} className="otp-slot" />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <div className="pin-status" aria-live="polite">
            {verifyingPin && <><LoaderCircle className="size-4 animate-spin" /> 確認中</>}
            {!verifyingPin && pinError && <span className="error-text">{pinError}</span>}
          </div>
        </section>
        <Toaster position="top-center" />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">OUR LITTLE DAYS</p>
          <h1>珀翔diary</h1>
        </div>
        <Button
          className="add-button"
          size="icon"
          onClick={openNewEntry}
          aria-label="記録を追加"
        >
          <Plus className="size-6" />
        </Button>
      </header>

      {view === "memory" ? (
        <>
          <section className="time-controls" aria-label="振り返る時期">
            <div className="year-control">
              <div>
                <span>基準となる年</span>
                <strong>
                  {!yearsAgo
                    ? "記録なし"
                    : yearsAgo === "0" ? "今年" : `${yearsAgo}年前`}
                </strong>
              </div>
              <Select
                value={yearsAgo}
                onValueChange={(value) => {
                  setYearsAgo(value);
                  setWeekShift(0);
                }}
                disabled={!availableYearOffsets.length}
              >
                <SelectTrigger className="year-select" aria-label="基準となる年">
                  <SelectValue placeholder="記録なし" />
                </SelectTrigger>
                <SelectContent>
                  {availableYearOffsets.map((yearOffset) => (
                    <SelectItem key={yearOffset} value={String(yearOffset)}>
                      {yearOffset === 0 ? "今年" : `${yearOffset}年前`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="offset-control">
              <span>さらにさかのぼる</span>
              <div className="offset-strip">
                {offsets.map((offset) => (
                  <button
                    key={offset.key}
                    type="button"
                    className={offset.key === offsetKey ? "offset-chip active" : "offset-chip"}
                    onClick={() => {
                      setOffsetKey(offset.key);
                      setWeekShift(0);
                    }}
                  >
                    {offset.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="memory-panel" aria-labelledby="memory-title">
            <div className="memory-heading">
              <div>
                <span className="memory-kicker">
                  <Sparkles className="size-4" /> 今ごろの珀翔
                </span>
                <h2 id="memory-title">
                  {periodLabel === "最近" ? "直近1週間" : `${periodLabel}の7日間`}
                </h2>
              </div>
              <div className="week-stepper" aria-label="表示する週を切り替え">
                <button
                  type="button"
                  onClick={() => {
                    if (data?.previousWeekShift != null) setWeekShift(data.previousWeekShift);
                  }}
                  disabled={loading || data?.previousWeekShift == null}
                  aria-label="前の記録がある週を表示"
                  title="前の記録がある週"
                >
                  <ChevronLeft aria-hidden="true" />
                  <span>前</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (data?.nextWeekShift != null) setWeekShift(data.nextWeekShift);
                  }}
                  disabled={loading || data?.nextWeekShift == null}
                  aria-label="次の記録がある週を表示"
                  title="次の記録がある週"
                >
                  <span>次</span>
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="date-range">
              <CalendarDays className="size-4" />{dateRange}
              {loading && data && (
                <LoaderCircle
                  className="period-refresh-spinner size-4 animate-spin"
                  aria-label="最新の記録を確認中"
                />
              )}
            </div>
            <div className="week-summary" aria-label="1週間の珀翔の様子">
              <span>1週間の様子</span>
              {weekSummary.length ? (
                weekSummary.map((line) => <p key={line}>・{line}</p>)
              ) : (
                <p>この期間の記録はまだありません。</p>
              )}
            </div>
            <Button
              className="memory-copy"
              variant="secondary"
              onClick={() => void copyWeek()}
              disabled={!data?.entries.length}
            >
              <Clipboard />7日分をコピー
            </Button>
          </section>

          <section className="entries" aria-live="polite">
            {loading && !data && <LoadingState label="記録を読み込んでいます" />}
            {!loading && yearsLoaded && availableYearOffsets.length === 0 && (
              <EmptyState
                title="登録済みの記録はまだありません"
                description="右上の＋から、園とのやり取りを登録すると年を選べるようになります。"
              />
            )}
            {!loading && data?.entries.length === 0 && (
              <EmptyState
                title="この7日間の記録はまだありません"
                description="右上の＋から、園とのやり取りを登録できます。"
              />
            )}
            {data?.entries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                actions
                onEdit={() => openEditEntry(entry)}
              />
            ))}
          </section>
        </>
      ) : (
        <>
          <section className="list-toolbar">
            <div>
              <p className="section-kicker">ALL RECORDS</p>
              <h2>登録済みの記録</h2>
              <p>{allEntries.length}件</p>
            </div>
            <Button variant="outline" onClick={() => void exportExcel()}>
              <CloudDownload />Excel
            </Button>
          </section>
          <section className="entries list-entries" aria-live="polite">
            {listLoading && <LoadingState label="一覧を読み込んでいます" />}
            {!listLoading && allEntries.length === 0 && (
              <EmptyState
                title="登録済みの記録はありません"
                description="右上の＋から最初の記録を追加できます。"
              />
            )}
            {!listLoading && allEntries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                actions
                collapsible
                onEdit={() => openEditEntry(entry)}
                onDelete={() => setDeleteTarget(entry)}
              />
            ))}
          </section>
        </>
      )}

      <nav className="bottom-nav" aria-label="画面切り替え">
        <button
          type="button"
          className={view === "memory" ? "active" : ""}
          onClick={() => setView("memory")}
        >
          <Sparkles /><span>振り返り</span>
        </button>
        <button
          type="button"
          className={view === "list" ? "active" : ""}
          onClick={() => setView("list")}
        >
          <ListIcon /><span>記録一覧</span>
        </button>
      </nav>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent
          className="entry-dialog"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{editingEntry ? "記録を編集" : "記録を追加"}</DialogTitle>
            <DialogDescription>
              文字を貼り付けるか、写真・スクリーンショットから読み取れます。
            </DialogDescription>
          </DialogHeader>
          <div className="field-stack date-field">
            <Label htmlFor="diary-date">園に預けた日</Label>
            <Input
              id="diary-date"
              type="date"
              value={diaryDate}
              onChange={(event) => setDiaryDate(event.target.value)}
            />
          </div>
          <Tabs
            value={mode}
            onValueChange={(value) => setMode(value as "text" | "ocr")}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="text">文字で入力</TabsTrigger>
              <TabsTrigger value="ocr"><ImagePlus />写真から</TabsTrigger>
            </TabsList>
            <TabsContent value="text" className="form-content">
              <EntryFields
                daycareReply={daycareReply}
                setDaycareReply={setDaycareReply}
                parentMessage={parentMessage}
                setParentMessage={setParentMessage}
              />
            </TabsContent>
            <TabsContent value="ocr" className="form-content">
              {!ocrReady && (
                <div className="ocr-picker">
                  <ImagePlus className="size-8" />
                  <div>
                    <strong>写真・スクリーンショットを選択</strong>
                    <p>画像は保存せず、文字だけを読み取って文章を整えます。</p>
                  </div>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      setSelectedImage(event.target.files?.[0] ?? null);
                      setOcrReady(false);
                    }}
                  />
                  <Button
                    type="button"
                    onClick={() => void recognizeImage()}
                    disabled={!selectedImage || ocrRunning}
                  >
                    {ocrRunning
                      ? <><LoaderCircle className="animate-spin" />読み取り中 {ocrProgress}%</>
                      : "文字を読み取る"}
                  </Button>
                </div>
              )}
              {ocrReady && (
                <>
                  <div className="ocr-notice">
                    <Check className="size-4" />
                    不要な空白・改行・文字ノイズだけを整えています。内容を確認し、必要に応じて修正してください。
                  </div>
                  <EntryFields
                    daycareReply={daycareReply}
                    setDaycareReply={setDaycareReply}
                    parentMessage={parentMessage}
                    setParentMessage={setParentMessage}
                  />
                </>
              )}
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              キャンセル
            </Button>
            <Button
              onClick={() => void saveEntry()}
              disabled={saving || (mode === "ocr" && !ocrReady)}
            >
              {saving
                ? <><LoaderCircle className="animate-spin" />保存中</>
                : editingEntry ? "変更を保存" : "この内容で登録"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>この記録を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? displayDate(deleteTarget.diaryDate, true) : ""}
              の記録を削除します。この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void deleteEntry();
              }}
            >
              {deleting ? "削除中" : "削除する"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Toaster position="top-center" richColors />
    </main>
  );
}

function EntryCard({
  entry,
  actions = false,
  collapsible = false,
  onEdit,
  onDelete,
}: {
  entry: Entry;
  actions?: boolean;
  collapsible?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [expanded, setExpanded] = useState(!collapsible);
  return (
    <article className={`entry-card${collapsible ? " compact-entry" : ""}`}>
      {collapsible ? (
        <button
          type="button"
          className="entry-toggle"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-label={`${displayDate(entry.diaryDate, true)}の記録を${expanded ? "閉じる" : "開く"}`}
        >
          <strong>{displayDate(entry.diaryDate, true)}</strong>
          <span>{summarizeDay(entry)}</span>
          <ChevronDown className={expanded ? "expanded" : ""} aria-hidden="true" />
        </button>
      ) : (
        <div className="entry-date">
          <span className="entry-day">{Number(entry.diaryDate.slice(8, 10))}</span>
          <div className="entry-date-text">
            <strong>{displayDate(entry.diaryDate, true)}</strong>
            <span>{entry.sourceType === "ocr" ? "写真から登録" : "文字で登録"}</span>
          </div>
          {actions && onEdit && (
            <div className="entry-actions">
              <Button size="icon-sm" variant="ghost" onClick={onEdit} aria-label="編集">
                <Pencil />
              </Button>
            </div>
          )}
        </div>
      )}
      {expanded && (
        <>
          {collapsible && (
            <div className="entry-expanded-tools">
              <span>{entry.sourceType === "ocr" ? "写真から登録" : "文字で登録"}</span>
              {actions && (
                <div className="entry-actions">
                  {onEdit && (
                    <Button size="icon-sm" variant="ghost" onClick={onEdit} aria-label="編集">
                      <Pencil />
                    </Button>
                  )}
                  {onDelete && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="delete-button"
                      onClick={onDelete}
                      aria-label="削除"
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="entry-block reply-block">
            <h3><span className="label-dot blue" />園からの返事</h3>
            <p>{entry.daycareReply || "記録なし"}</p>
          </div>
          <div className="entry-block message-block">
            <h3><span className="label-dot yellow" />こちらからの連絡</h3>
            <p>{entry.parentMessage || "記録なし"}</p>
          </div>
        </>
      )}
    </article>
  );
}

function EntryFields({
  daycareReply,
  setDaycareReply,
  parentMessage,
  setParentMessage,
}: {
  daycareReply: string;
  setDaycareReply: (value: string) => void;
  parentMessage: string;
  setParentMessage: (value: string) => void;
}) {
  return (
    <>
      <div className="field-stack">
        <Label htmlFor="daycare-reply">園からの返事</Label>
        <Textarea
          id="daycare-reply"
          rows={6}
          placeholder="園から届いた内容を貼り付け"
          value={daycareReply}
          onChange={(event) => setDaycareReply(event.target.value)}
        />
      </div>
      <div className="field-stack">
        <Label htmlFor="parent-message">こちらからの連絡</Label>
        <Textarea
          id="parent-message"
          rows={5}
          placeholder="園へ送った内容を貼り付け"
          value={parentMessage}
          onChange={(event) => setParentMessage(event.target.value)}
        />
      </div>
    </>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="empty-state">
      <LoaderCircle className="size-7 animate-spin" />
      <p>{label}</p>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">☁︎</div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
