import { Request, Response } from "express";

// ============================================================================
// Types
// ============================================================================

export interface ViolationType {
  code: string;
  label: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
}

export interface ViolationMatch {
  type: string;
  matched: string;
  position: number;
  length: number;
}

export interface ModerationResult {
  passed: boolean;
  confidence: number;
  violations: ViolationMatch[];
  categories: {
    profanity: boolean;
    adult: boolean;
    copyrighted: boolean;
    spam: boolean;
    violence: boolean;
    hate: boolean;
  };
  classification: {
    primaryViolation: string | null;
    secondaryViolations: string[];
  };
  flags: string[];
  message: string;
}

export interface CoverAnalysisResult {
  passed: boolean;
  confidence: number;
  issues: {
    code: string;
    description: string;
    severity: "low" | "medium" | "high" | "critical";
  }[];
  safeIndicators: string[];
  message: string;
}

// ============================================================================
// Banned Words & Patterns Database
// ============================================================================

const PROFANITY_PATTERNS = [
  // Vietnamese profanity
  /địt|mẹ|đụ|lồn|cặc|bướm|chim|cu|kiss|địt|má|con\s*mẹ|bố|cha|fuck|shit|damn|ass/i,
  /xxx|porn|xxx\.com|free\s*porn/i,
  // Generic offensive patterns
  /\b(idiot|moron|stupid|dumb)\b/gi,
];

const ADULT_CONTENT_PATTERNS = [
  /18\+|19\+|21\+|nude|naked|sexy|seductive|bikini/i,
  /\b(nsfw|guro|yuri|yaoi|hentai)\b/gi,
  /explicit\s*content|adult\s*only|xxx\s*rated/i,
  /\b(schoolgirl|schoolboy)\s*(hot|sexy|naked)/i,
  /blood\s*(gore|shed)|guro/i,
];

const COPYRIGHT_PATTERNS = [
  /\b(harry\s*potter|twilight|game\s*of\s*thrones|marvel\s*universe|dc\s*comics)\b/gi,
  /\b(dragon\s*ball|one\s*piece|naruto|bleach)\b/gi,
  /\b(star\s*wars|star\s*trek|matrix)\b/gi,
  /\bcopyright\s*©|©\s*\d{4}|all\s*rights\s*reserved/i,
  /\bofficial\s*fanfic|official\s*sequel/i,
];

const SPAM_PATTERNS = [
  /(https?:\/\/[^\s]+){5,}/i, // Multiple URLs
  /(.)\1{5,}/i, // Repeated characters
  /click\s*(here|now)|buy\s*now|win\s*(now|free)|free\s*money/i,
  /\b(viagra|cialis|casino|lottery)\b/gi,
  /congratulations\s*you\s*(won|are\s*the\s*winner)/i,
  /earn\s*\$\d+|make\s*\$.*per\s*day/i,
  /\[\s*[A-Z]{3,}\s*\]\s*\[/i, // [ABC] pattern spam
];

const VIOLENCE_PATTERNS = [
  /torture|rape|murder|kill|slay|dismember/i,
  /blood|gore|guts|intestine|organ/i,
  /\b(brutal\s*death|graphic\s*violence)\b/gi,
  /pedophile|pedophilia|incest/i,
  /suicide\s*method|how\s*to\s*kill|how\s*to\s*die/i,
];

const HATE_PATTERNS = [
  /\b(kill\s*all|hate\s*you|death\s*to|nuke)\s*(jews|blacks|whites|asians|muslims|christians)\b/gi,
  /white\s*power|white\s*supremacy|nazi|kkk|racist/i,
  /\b(歧视|种族主义|排外)\b/gi,
];

// Pattern to detect excessive caps
const EXCESSIVE_CAPS_PATTERN = /[A-Z]{10,}/;

// Pattern to detect excessive emojis/special chars
const EXCESSIVE_SPECIAL_PATTERN = /[!@#$%^&*()]{10,}/;

// ============================================================================
// Violation Type Definitions
// ============================================================================

export const VIOLATION_TYPES: ViolationType[] = [
  {
    code: "PROFANITY",
    label: "Profanity / Inappropriate Language",
    severity: "medium",
    description: "Contains profanity, vulgar language, or offensive words",
  },
  {
    code: "ADULT_CONTENT",
    label: "Adult Content",
    severity: "high",
    description: "Contains sexually explicit or adult-oriented material",
  },
  {
    code: "COPYRIGHT",
    label: "Copyright Violation",
    severity: "critical",
    description: "Contains copyrighted material from known sources",
  },
  {
    code: "SPAM",
    label: "Spam",
    severity: "low",
    description: "Contains spam patterns or promotional content",
  },
  {
    code: "VIOLENCE",
    label: "Violence / Gore",
    severity: "high",
    description: "Contains graphic violence, torture, or gore",
  },
  {
    code: "HATE_SPEECH",
    label: "Hate Speech",
    severity: "critical",
    description: "Contains hate speech or discriminatory content",
  },
  {
    code: "EXCESSIVE_CAPS",
    label: "Excessive Capitalization",
    severity: "low",
    description: "Contains excessive use of capital letters",
  },
  {
    code: "SENSITIVE_CONTENT",
    label: "Sensitive Content",
    severity: "medium",
    description: "Contains content that may be sensitive to some audiences",
  },
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Find all pattern matches in text
 */
function findMatches(text: string, patterns: RegExp[]): ViolationMatch[] {
  const matches: ViolationMatch[] = [];
  
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        type: pattern.source,
        matched: match[0],
        position: match.index,
        length: match[0].length,
      });
      
      // Prevent infinite loop for zero-length matches
      if (match[0].length === 0) {
        regex.lastIndex++;
      }
    }
  }
  
  return matches;
}

/**
 * Calculate severity weight
 */
function getSeverityWeight(severity: ViolationType["severity"]): number {
  switch (severity) {
    case "critical":
      return 1.0;
    case "high":
      return 0.75;
    case "medium":
      return 0.5;
    case "low":
      return 0.25;
    default:
      return 0.5;
  }
}

/**
 * Determine if content is suspicious enough to flag
 */
function calculateSuspicionScore(matches: ViolationMatch[]): number {
  if (matches.length === 0) return 0;
  
  // Weight by number of unique violation types
  const uniqueTypes = new Set(matches.map(m => m.type));
  return Math.min(1, matches.length * 0.15 + uniqueTypes.size * 0.2);
}

// ============================================================================
// Main Moderation Functions
// ============================================================================

/**
 * Analyze text content for violations
 * This is the main entry point for content moderation
 */
export function analyzeContent(text: string): ModerationResult {
  if (!text || typeof text !== "string") {
    return {
      passed: true,
      confidence: 1.0,
      violations: [],
      categories: {
        profanity: false,
        adult: false,
        copyrighted: false,
        spam: false,
        violence: false,
        hate: false,
      },
      classification: {
        primaryViolation: null,
        secondaryViolations: [],
      },
      flags: [],
      message: "No content provided or invalid input",
    };
  }

  // Normalize text for analysis
  const normalizedText = text.toLowerCase().trim();
  const violations: ViolationMatch[] = [];
  const flags: string[] = [];

  // Check each category
  const profanityMatches = findMatches(normalizedText, PROFANITY_PATTERNS);
  violations.push(...profanityMatches);
  
  const adultMatches = findMatches(normalizedText, ADULT_CONTENT_PATTERNS);
  violations.push(...adultMatches);
  
  const copyrightMatches = findMatches(normalizedText, COPYRIGHT_PATTERNS);
  violations.push(...copyrightMatches);
  
  const spamMatches = findMatches(normalizedText, SPAM_PATTERNS);
  violations.push(...spamMatches);
  
  const violenceMatches = findMatches(normalizedText, VIOLENCE_PATTERNS);
  violations.push(...violenceMatches);
  
  const hateMatches = findMatches(normalizedText, HATE_PATTERNS);
  violations.push(...hateMatches);
  
  // Check for excessive caps
  const capsMatches = normalizedText.match(EXCESSIVE_CAPS_PATTERN);
  if (capsMatches) {
    capsMatches.forEach(match => {
      violations.push({
        type: "EXCESSIVE_CAPS",
        matched: match,
        position: normalizedText.indexOf(match),
        length: match.length,
      });
    });
  }
  
  // Check for excessive special characters
  const specialMatches = normalizedText.match(EXCESSIVE_SPECIAL_PATTERN);
  if (specialMatches) {
    specialMatches.forEach(match => {
      violations.push({
        type: "EXCESSIVE_SPECIAL",
        matched: match,
        position: normalizedText.indexOf(match),
        length: match.length,
      });
    });
  }

  // Build category flags
  const categories = {
    profanity: profanityMatches.length > 0,
    adult: adultMatches.length > 0,
    copyrighted: copyrightMatches.length > 0,
    spam: spamMatches.length > 0,
    violence: violenceMatches.length > 0,
    hate: hateMatches.length > 0,
  };

  // Count violations by type for classification
  const violationCounts: Record<string, number> = {};
  for (const v of violations) {
    const type = getViolationTypeFromPattern(v.type);
    violationCounts[type] = (violationCounts[type] || 0) + 1;
  }

  // Determine primary and secondary violations
  const sortedViolations = Object.entries(violationCounts)
    .sort((a, b) => b[1] - a[1]);

  const primaryViolation = sortedViolations[0]?.[0] || null;
  const secondaryViolations = sortedViolations.slice(1).map(([type]) => type);

  // Add severity-based flags
  if (profanityMatches.length > 0) flags.push("CONTAINS_PROFANITY");
  if (adultMatches.length > 0) flags.push("ADULT_CONTENT_DETECTED");
  if (copyrightMatches.length > 0) flags.push("COPYRIGHT_CONCERN");
  if (spamMatches.length > 0) flags.push("SPAM_PATTERN_DETECTED");
  if (violenceMatches.length > 0) flags.push("VIOLENT_CONTENT");
  if (hateMatches.length > 0) flags.push("HATE_SPEECH_DETECTED");

  // Calculate confidence score
  const confidence = calculateConfidence({
    passed: violations.length === 0,
    violationCount: violations.length,
    uniqueCategories: Object.values(categories).filter(Boolean).length,
  });

  // Determine if content passes
  const hasCriticalViolation = [
    ...copyrightMatches,
    ...hateMatches,
  ].length > 0;
  
  const hasHighViolation = [...adultMatches, ...violenceMatches].length > 0;

  const passed = !hasCriticalViolation && violations.length < 3 && !hasHighViolation;

  // Generate message
  let message = "Content passed all checks";
  if (!passed) {
    if (hasCriticalViolation) {
      message = "Content contains critical violations that require immediate review";
    } else if (hasHighViolation) {
      message = "Content contains high-severity violations that require review";
    } else {
      message = "Content contains minor violations that may require attention";
    }
  }

  return {
    passed,
    confidence,
    violations,
    categories,
    classification: {
      primaryViolation,
      secondaryViolations,
    },
    flags,
    message,
  };
}

/**
 * Get violation type string from pattern source
 */
function getViolationTypeFromPattern(patternSource: string): string {
  if (patternSource.includes("PROFANITY")) return "PROFANITY";
  if (patternSource.includes("ADULT")) return "ADULT_CONTENT";
  if (patternSource.includes("COPYRIGHT")) return "COPYRIGHT";
  if (patternSource.includes("SPAM")) return "SPAM";
  if (patternSource.includes("VIOLENCE")) return "VIOLENCE";
  if (patternSource.includes("HATE")) return "HATE_SPEECH";
  if (patternSource.includes("EXCESSIVE_CAPS")) return "EXCESSIVE_CAPS";
  if (patternSource.includes("EXCESSIVE_SPECIAL")) return "SENSITIVE_CONTENT";
  return "UNKNOWN";
}

/**
 * Classify violation type from moderation result
 * Returns detailed classification of the violation
 */
export function classifyViolation(
  content: string
): {
  type: string;
  severity: ViolationType["severity"];
  confidence: number;
  details: string;
} {
  const result = analyzeContent(content);

  if (result.passed) {
    return {
      type: "NONE",
      severity: "low",
      confidence: result.confidence,
      details: "No violations detected",
    };
  }

  const primaryType = result.classification.primaryViolation || "UNKNOWN";
  const violationType = VIOLATION_TYPES.find(v => v.code === primaryType);
  
  return {
    type: primaryType,
    severity: violationType?.severity || "medium",
    confidence: result.confidence,
    details: violationType?.description || "Unknown violation type",
  };
}

/**
 * Calculate confidence score based on analysis results
 * Higher confidence means the result is more certain
 */
export function calculateConfidence(result: {
  passed: boolean;
  violationCount: number;
  uniqueCategories: number;
}): number {
  if (result.passed && result.violationCount === 0) {
    return 0.98; // Very confident it's clean
  }

  if (!result.passed) {
    // More violations = higher confidence it's actually bad
    const baseConfidence = 0.7;
    const violationBonus = Math.min(0.25, result.violationCount * 0.05);
    const categoryBonus = result.uniqueCategories * 0.02;
    return Math.min(0.99, baseConfidence + violationBonus + categoryBonus);
  }

  // Passed but with some violations
  const baseConfidence = 0.6;
  const violationPenalty = Math.min(0.1, result.violationCount * 0.02);
  return Math.max(0.5, baseConfidence - violationPenalty);
}

/**
 * Analyze cover image URL
 * For now, uses URL-based heuristics (can be enhanced with actual image analysis)
 */
export function analyzeCover(imageUrl: string): CoverAnalysisResult {
  if (!imageUrl || typeof imageUrl !== "string") {
    return {
      passed: true,
      confidence: 1.0,
      issues: [],
      safeIndicators: ["NO_IMAGE_PROVIDED"],
      message: "No image provided or invalid input",
    };
  }

  const issues: CoverAnalysisResult["issues"] = [];
  const safeIndicators: string[] = [];
  const url = imageUrl.toLowerCase();

  // Check URL patterns that might indicate problematic content
  const suspiciousPatterns = [
    { pattern: /porn|xnxx|xvideos|redtube/i, code: "ADULT_DOMAIN", description: "Image hosted on adult content domain" },
    { pattern: /guro|gore|vore/i, code: "GORE_CONTENT", description: "URL suggests gore content" },
    { pattern: /nsfw/i, code: "NSFW_FLAG", description: "URL explicitly marked as NSFW" },
  ];

  for (const { pattern, code, description } of suspiciousPatterns) {
    if (pattern.test(url)) {
      issues.push({
        code,
        description,
        severity: code === "NSFW_FLAG" ? "medium" : "high",
      });
    }
  }

  // Check for safe/trusted domains
  const trustedDomains = [
    "cloudinary.com",
    "supabase.co",
    "imgur.com",
    "imgur.io",
    "cdn.",
    "amazonaws.com",
  ];

  for (const domain of trustedDomains) {
    if (url.includes(domain)) {
      safeIndicators.push(`TRUSTED_DOMAIN_${domain.replace(".", "_").toUpperCase()}`);
    }
  }

  // Check for proper image extensions
  const validExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
  const hasValidExtension = validExtensions.some(ext => url.endsWith(ext));
  if (hasValidExtension) {
    safeIndicators.push("VALID_IMAGE_EXTENSION");
  }

  // Calculate confidence
  let confidence = 0.5; // Base confidence
  if (safeIndicators.length > 0) confidence += safeIndicators.length * 0.1;
  if (issues.length > 0) confidence -= issues.length * 0.15;
  confidence = Math.max(0.3, Math.min(0.95, confidence));

  // Determine if passed
  const hasHighSeverityIssue = issues.some(i => i.severity === "high" || i.severity === "critical");
  const passed = issues.length === 0 || !hasHighSeverityIssue;

  // Generate message
  let message = "Cover image appears safe";
  if (issues.length > 0) {
    if (hasHighSeverityIssue) {
      message = "Cover image has issues that require review";
    } else {
      message = "Cover image has minor concerns";
    }
  }

  return {
    passed,
    confidence,
    issues,
    safeIndicators,
    message,
  };
}

/**
 * Batch analyze multiple content items
 */
export function batchAnalyzeContent(items: string[]): ModerationResult[] {
  return items.map(item => analyzeContent(item));
}

/**
 * Get all violation types with details
 */
export function getViolationTypes(): ViolationType[] {
  return VIOLATION_TYPES;
}

/**
 * Check if content requires immediate moderation review
 */
export function requiresImmediateReview(result: ModerationResult): boolean {
  // Critical violations always require immediate review
  if (result.categories.copyrighted || result.categories.hate) {
    return true;
  }

  // Multiple violations of any type
  if (result.violations.length >= 5) {
    return true;
  }

  // High confidence bad content
  if (result.confidence >= 0.9 && !result.passed) {
    return true;
  }

  return false;
}
