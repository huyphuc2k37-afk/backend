/**
 * Bot Detection Module
 *
 * Provides multi-layer bot detection:
 * 1. User-Agent pattern matching
 * 2. Suspicious behavior detection
 * 3. Known bot patterns
 */

export interface BotDetectionResult {
  isBot: boolean;
  confidence: number; // 0-1, higher = more likely bot
  reasons: string[];
  category: "known_bot" | "suspicious" | "likely_bot" | "clean";
}

// Known bot User-Agent patterns
const KNOWN_BOT_PATTERNS = [
  /googlebot/i,
  /bingbot/i,
  /yandexbot/i,
  /baiduspider/i,
  /duckduckbot/i,
  /slurp/i,
  /exabot/i,
  /facebot/i,
  /ia_archiver/i,
  /applebot/i,
  /semrush/i,
  /ahrefs/i,
  /mj12bot/i,
  /rogerbot/i,
  /linkedinbot/i,
  /twitterbot/i,
  /facebookexternalhit/i,
  /pinterest/i,
  /telegrambot/i,
];

// Suspicious User-Agent patterns (tools/scripts)
const SUSPICIOUS_PATTERNS = [
  /curl/i,
  /wget/i,
  /python/i,
  /java\//i,
  /go-http/i,
  /axios/i,
  /node-fetch/i,
  /okhttp/i,
  /httpclient/i,
  /scrapy/i,
  /mechanize/i,
  /phantomjs/i,
  /selenium/i,
  /playwright/i,
  /puppeteer/i,
  /headless/i,
  /libwww/i,
  /httpunit/i,
  /webbot/i,
  /spider/i,
  /crawl/i,
];

// Headless browser indicators
const HEADLESS_PATTERNS = [
  /headless/i,
  /phantom/i,
  /zombie/i,
  /puppeteer/i,
  /playwright/i,
  /selenium/i,
];

// Mobile app indicators (legitimate)
const LEGITIMATE_MOBILE_PATTERNS = [
  /android/i,
  /iphone/i,
  /ipad/i,
  /mobile/i,
  /windows phone/i,
  /blackberry/i,
];

// Known browsers (legitimate)
const BROWSER_PATTERNS = [
  /chrome\/[\d.]+/i,
  /firefox\/[\d.]+/i,
  /safari\/[\d.]+/i,
  /edge\/[\d.]+/i,
  /opera|opr\/[\d.]+/i,
  /vivaldi\/[\d.]+/i,
  /brave\/[\d.]+/i,
];

/**
 * Analyze User-Agent string for bot indicators
 */
export function analyzeUserAgent(userAgent: string | undefined): {
  isKnownBot: boolean;
  isSuspicious: boolean;
  isHeadless: boolean;
  hasBrowser: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  let isKnownBot = false;
  let isSuspicious = false;
  let isHeadless = false;
  let hasBrowser = false;

  if (!userAgent || userAgent.trim() === "") {
    reasons.push("Empty or missing User-Agent");
    isSuspicious = true;
  }

  // Check for known bots
  for (const pattern of KNOWN_BOT_PATTERNS) {
    if (pattern.test(userAgent || "")) {
      reasons.push(`Known bot detected: ${pattern.source}`);
      isKnownBot = true;
      break;
    }
  }

  // Check for suspicious patterns
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(userAgent || "")) {
      reasons.push(`Suspicious UA: ${pattern.source}`);
      isSuspicious = true;
      break;
    }
  }

  // Check for headless browsers
  for (const pattern of HEADLESS_PATTERNS) {
    if (pattern.test(userAgent || "")) {
      reasons.push("Headless browser detected");
      isHeadless = true;
      break;
    }
  }

  // Check for legitimate browser
  for (const pattern of BROWSER_PATTERNS) {
    if (pattern.test(userAgent || "")) {
      hasBrowser = true;
      break;
    }
  }

  return { isKnownBot, isSuspicious, isHeadless, hasBrowser, reasons };
}

/**
 * Calculate bot confidence score based on multiple factors
 */
export function calculateBotScore(
  analysis: ReturnType<typeof analyzeUserAgent>,
  ipReputation: { viewCount: number; isBanned: boolean },
  viewFrequency: number // views per hour
): number {
  let score = 0;

  // Known bot = 100% bot
  if (analysis.isKnownBot) {
    return 1.0;
  }

  // Empty UA is suspicious
  if (!analysis.hasBrowser && !analysis.reasons.includes("Empty or missing User-Agent")) {
    score += 0.2;
  }

  // Suspicious patterns
  if (analysis.isSuspicious) {
    score += 0.3;
  }

  // Headless browser
  if (analysis.isHeadless) {
    score += 0.25;
  }

  // High view frequency (> 100 views/hour is suspicious)
  if (viewFrequency > 100) {
    score += 0.3;
  } else if (viewFrequency > 50) {
    score += 0.15;
  }

  // High total views from single IP
  if (ipReputation.viewCount > 1000) {
    score += 0.15;
  } else if (ipReputation.viewCount > 500) {
    score += 0.1;
  }

  // Already banned = high confidence
  if (ipReputation.isBanned) {
    score = Math.min(1.0, score + 0.3);
  }

  return Math.min(1.0, score);
}

/**
 * Main bot detection function
 */
export function detectBot(
  userAgent: string | undefined,
  ipReputation: { viewCount: number; isBanned: boolean },
  viewFrequency: number
): BotDetectionResult {
  const analysis = analyzeUserAgent(userAgent);
  const confidence = calculateBotScore(analysis, ipReputation, viewFrequency);

  // Determine category
  let category: BotDetectionResult["category"];
  if (analysis.isKnownBot || (ipReputation.isBanned && confidence > 0.7)) {
    category = "known_bot";
  } else if (confidence >= 0.6) {
    category = "likely_bot";
  } else if (confidence >= 0.3 || analysis.isSuspicious || analysis.isHeadless) {
    category = "suspicious";
  } else {
    category = "clean";
  }

  return {
    isBot: category === "known_bot" || category === "likely_bot",
    confidence,
    reasons: analysis.reasons,
    category,
  };
}

/**
 * Check if User-Agent is from a legitimate mobile app
 */
export function isLegitimateMobileApp(userAgent: string | undefined): boolean {
  if (!userAgent) return false;
  for (const pattern of LEGITIMATE_MOBILE_PATTERNS) {
    if (pattern.test(userAgent)) {
      return true;
    }
  }
  return false;
}

/**
 * Extract browser info from User-Agent
 */
export function parseBrowserInfo(
  userAgent: string | undefined
): { browser: string; os: string; isMobile: boolean } {
  const result = { browser: "Unknown", os: "Unknown", isMobile: false };

  if (!userAgent) return result;

  // Detect mobile
  for (const pattern of LEGITIMATE_MOBILE_PATTERNS) {
    if (pattern.test(userAgent)) {
      result.isMobile = true;
      break;
    }
  }

  // Detect browser
  if (/chrome\/[\d.]+/i.test(userAgent) && !/edg\/[\d.]+/i.test(userAgent)) {
    result.browser = "Chrome";
  } else if (/firefox\/[\d.]+/i.test(userAgent)) {
    result.browser = "Firefox";
  } else if (/safari\/[\d.]+/i.test(userAgent) && !/chrome\/[\d.]+/i.test(userAgent)) {
    result.browser = "Safari";
  } else if (/edg\/[\d.]+/i.test(userAgent)) {
    result.browser = "Edge";
  } else if (/opera|opr\/[\d.]+/i.test(userAgent)) {
    result.browser = "Opera";
  }

  // Detect OS
  if (/windows nt/i.test(userAgent)) {
    result.os = "Windows";
  } else if (/mac os x/i.test(userAgent)) {
    result.os = "macOS";
  } else if (/linux/i.test(userAgent)) {
    result.os = "Linux";
  } else if (/android/i.test(userAgent)) {
    result.os = "Android";
  } else if (/iphone|ipad/i.test(userAgent)) {
    result.os = "iOS";
  }

  return result;
}
