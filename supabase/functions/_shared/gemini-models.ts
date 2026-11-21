// ============================================================================
// CENTRALIZED GEMINI MODEL CONFIGURATION REGISTRY
// Verified against Google Gemini v1beta /models endpoint:
//   1. gemini-3.8-flash          (Gemini 3.8 Flash - Primary)
//   2. gemini-3-flash-preview    (Gemini 3 Flash Preview - Secondary)
//   3. gemini-flash-lite-latest  (Gemini Flash-Lite Latest - Fallback)
// Add, disable, or reorder models here without modifying core generation logic.
// ============================================================================

export type GeminiInputType = "text" | "pdf" | "image" | "docx" | "json_output";

export interface GeminiModelConfig {
  id: string;
  displayName: string;
  priority: number;
  enabled: boolean;
  supportedInputTypes: GeminiInputType[];
  fallbackEligible: boolean;
  supportsThinkingConfig: boolean;
  maxInputTokens: number;
}

export const GEMINI_MODEL_REGISTRY: GeminiModelConfig[] = [
  {
    id: "gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    priority: 1,
    enabled: true,
    supportedInputTypes: ["text", "pdf", "image", "docx", "json_output"],
    fallbackEligible: true,
    supportsThinkingConfig: true,
    maxInputTokens: 1_048_576,
  },
  {
    id: "gemini-3-flash-preview",
    displayName: "Gemini 3 Flash",
    priority: 2,
    enabled: true,
    supportedInputTypes: ["text", "pdf", "image", "docx", "json_output"],
    fallbackEligible: true,
    supportsThinkingConfig: true,
    maxInputTokens: 1_048_576,
  },
  {
    id: "gemini-flash-lite-latest",
    displayName: "Gemini Flash-Lite",
    priority: 3,
    enabled: true,
    supportedInputTypes: ["text", "pdf", "image", "docx", "json_output"],
    fallbackEligible: true,
    supportsThinkingConfig: true,
    maxInputTokens: 1_048_576,
  },
];

/**
 * Returns enabled models sorted by ascending priority, optionally filtered by required input type
 * and respecting an optional preferred/configured model ID as the starting attempt.
 */
export function getActiveGeminiModels(options?: {
  requiredInput?: GeminiInputType;
  preferredModelId?: string | null;
  registry?: GeminiModelConfig[];
}): GeminiModelConfig[] {
  const source = options?.registry ?? GEMINI_MODEL_REGISTRY;
  const required = options?.requiredInput;

  const eligible = source
    .filter((m) => m.enabled)
    .filter((m) => !required || m.supportedInputTypes.includes(required))
    .sort((a, b) => a.priority - b.priority);

  if (eligible.length === 0) return [];

  const envConfigured =
    typeof Deno !== "undefined" ? Deno.env?.get?.("GEMINI_MODEL")?.trim() : "";
  const preferredId = options?.preferredModelId?.trim() || envConfigured;

  let ordered = eligible;

  if (preferredId) {
    const preferred = eligible.find((m) => m.id === preferredId);
    if (preferred) {
      ordered = [
        preferred,
        ...eligible.filter((m) => m.id !== preferred.id && m.fallbackEligible),
      ];
    } else if (preferredId) {
      // Allow explicit env override even if not in default registry, while keeping registry fallbacks
      ordered = [
        {
          id: preferredId,
          displayName: preferredId,
          priority: 0,
          enabled: true,
          supportedInputTypes: ["text", "pdf", "image", "docx", "json_output"],
          fallbackEligible: true,
          supportsThinkingConfig: true,
          maxInputTokens: 1_048_576,
        },
        ...eligible.filter((m) => m.fallbackEligible),
      ];
    }
  } else {
    // Primary model (first) + eligible fallbacks
    const [primary, ...rest] = eligible;
    ordered = [primary, ...rest.filter((m) => m.fallbackEligible)];
  }

  return ordered;
}

export function getGeminiModelDisplayName(modelId: string): string {
  const found = GEMINI_MODEL_REGISTRY.find((m) => m.id === modelId);
  return found ? found.displayName : modelId;
}
