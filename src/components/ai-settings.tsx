"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Save,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from "lucide-react";
import { z } from "zod";
import {
  AI_STAGES,
  CHAT_AI_STAGES,
  DEFAULT_GEMINI_IMAGE_MODEL,
  type AIStage,
} from "@/lib/ai-config-schema";

const configurationSchema = z.object({
  stage: z.enum(AI_STAGES),
  providerName: z.string(),
  baseUrl: z.string(),
  modelName: z.string(),
  temperature: z.number(),
  maxOutputTokens: z.number(),
  requestTimeoutMs: z.number(),
  retryLimit: z.number(),
  enabled: z.boolean(),
  hasApiKey: z.boolean(),
  updatedAt: z.string().nullable(),
});

const settingsResponseSchema = z.object({
  configurations: z.array(configurationSchema),
  encryptionKeyConfigured: z.boolean(),
});

const saveResponseSchema = z.object({
  configurations: z.array(configurationSchema),
  message: z.string(),
});

const testResponseSchema = z.object({
  ok: z.literal(true),
  providerName: z.string(),
  configuredModel: z.string(),
  returnedModel: z.string().nullable(),
  latencyMs: z.number(),
  tokenUsage: z
    .object({
      prompt: z.number().nullable(),
      completion: z.number().nullable(),
      total: z.number().nullable(),
    })
    .nullable(),
  jsonMode: z.enum(["native", "prompt"]),
  imageWidth: z.number().optional(),
  imageHeight: z.number().optional(),
});

const apiErrorSchema = z.object({
  error: z.string(),
  issues: z
    .array(z.object({ field: z.string(), message: z.string() }))
    .optional(),
});

const stageDetails: Record<AIStage, { label: string; description: string }> = {
  research: {
    label: "Research synthesis",
    description: "Summarize retrieved evidence into niche intelligence.",
  },
  idea_generation: {
    label: "Idea generation",
    description: "Create research-grounded content opportunities.",
  },
  idea_evaluation: {
    label: "Idea evaluation",
    description: "Assess idea quality and explain the scoring criteria.",
  },
  content_generation: {
    label: "Content generation",
    description: "Write Pinterest titles, descriptions, keywords, and hashtags.",
  },
  image_prompt_generation: {
    label: "Image prompt generation",
    description: "Create detailed, idea-specific visual generation prompts.",
  },
  image_generation: {
    label: "Image generation (Gemini)",
    description: "Opens Gemini in your browser via Playwright. Paste the prompt, generate, then upload here.",
  },
};

interface ConfigurationForm {
  providerName: string;
  baseUrl: string;
  modelName: string;
  apiKey: string;
  temperature: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  retryLimit: number;
  hasApiKey: boolean;
  configured: boolean;
  requiresProviderTokenReplacement: boolean;
}

function blankForm(stage?: AIStage): ConfigurationForm {
  return {
    providerName: stage === "image_generation" ? "Playwright Gemini" : "",
    baseUrl:
      stage === "image_generation"
        ? "https://gemini.google.com/app"
        : "",
    modelName:
      stage === "image_generation"
        ? DEFAULT_GEMINI_IMAGE_MODEL
        : "",
    apiKey: "",
    temperature: 0.7,
    maxOutputTokens: 4096,
    requestTimeoutMs: 60_000,
    retryLimit: 3,
    hasApiKey: false,
    configured: false,
    requiresProviderTokenReplacement: false,
  };
}

function makeForms(
  configurations: z.infer<typeof configurationSchema>[],
): Record<AIStage, ConfigurationForm> {
  return Object.fromEntries(
    AI_STAGES.map((stage) => {
      const saved = configurations.find((configuration) => configuration.stage === stage);
      return [
        stage,
        saved
          ? {
              providerName:
                stage === "image_generation"
                  ? "Playwright Gemini"
                  : saved.providerName,
              baseUrl:
                stage === "image_generation"
                  ? "https://gemini.google.com/app"
                  : saved.baseUrl,
              modelName:
                stage === "image_generation"
                  ? (saved.modelName.trim() || DEFAULT_GEMINI_IMAGE_MODEL)
                  : saved.modelName,
              apiKey: "",
              temperature: saved.temperature,
              maxOutputTokens: saved.maxOutputTokens,
              requestTimeoutMs: saved.requestTimeoutMs,
              retryLimit: saved.retryLimit,
              hasApiKey: saved.hasApiKey,
              configured: saved.enabled,
              requiresProviderTokenReplacement: false,
            }
          : blankForm(stage),
      ];
    }),
  ) as Record<AIStage, ConfigurationForm>;
}

function usableResponse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  fallbackMessage: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(fallbackMessage);
  }
  return parsed.data;
}

function responseError(value: unknown, fallback: string): string {
  const parsed = apiErrorSchema.safeParse(value);
  if (!parsed.success) return fallback;
  const details = parsed.data.issues
    ?.map(({ field, message }) => (field ? `${field}: ${message}` : message))
    .join("; ");
  return details
    ? `${parsed.data.error} ${details}`
    : parsed.data.error;
}

function stageConfigurationsEqual(
  forms: Record<AIStage, ConfigurationForm>,
): boolean {
  const [first, ...others] = CHAT_AI_STAGES.map((stage) => forms[stage]);
  return others.every(
    (form) =>
      form.providerName === first.providerName &&
      form.baseUrl === first.baseUrl &&
      form.modelName === first.modelName &&
      form.temperature === first.temperature &&
      form.maxOutputTokens === first.maxOutputTokens &&
      form.requestTimeoutMs === first.requestTimeoutMs &&
      form.retryLimit === first.retryLimit,
  );
}

export function AISettings() {
  const router = useRouter();
  const [forms, setForms] = useState<Record<AIStage, ConfigurationForm>>(() =>
    makeForms([]),
  );
  const [commonForm, setCommonForm] = useState<ConfigurationForm>(blankForm);
  const [commonMode, setCommonMode] = useState(true);
  const [encryptionKeyConfigured, setEncryptionKeyConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testedStage, setTestedStage] = useState<AIStage>("research");
  const [showKeys, setShowKeys] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const configuredStages = useMemo(
    () => AI_STAGES.filter((stage) => forms[stage].configured).length,
    [forms],
  );
  const imageForm = forms.image_generation;
  const canTestImageConfiguration = encryptionKeyConfigured;

  useEffect(() => {
    async function loadSettings() {
      try {
        const response = await fetch("/api/ai/config", { cache: "no-store" });
        const payload: unknown = await response.json();
        if (!response.ok) {
          throw new Error(responseError(payload, "Could not load AI settings."));
        }
        const result = usableResponse(
          settingsResponseSchema,
          payload,
          "The server returned invalid AI settings.",
        );
        const loadedForms = makeForms(result.configurations);
        setForms(loadedForms);
        setCommonForm({
          ...loadedForms.research,
          apiKey: "",
          hasApiKey: CHAT_AI_STAGES.every((stage) => loadedForms[stage].hasApiKey),
        });
        setCommonMode(
          CHAT_AI_STAGES.every(
            (stage) => !loadedForms[stage].configured,
          ) ||
            stageConfigurationsEqual(loadedForms),
        );
        setEncryptionKeyConfigured(result.encryptionKeyConfigured);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load AI settings.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadSettings();
  }, []);

  function updateForm(
    stage: AIStage,
    field: keyof ConfigurationForm,
    value: string | number,
  ) {
    setForms((current) => ({
      ...current,
      [stage]: { ...current[stage], [field]: value },
    }));
    setError(null);
    setNotice(null);
    setTestResult(null);
  }

  function updateCommonForm(
    field: keyof ConfigurationForm,
    value: string | number,
  ) {
    setCommonForm((current) => ({ ...current, [field]: value }));
    setError(null);
    setNotice(null);
    setTestResult(null);
  }

  async function saveSettings(stage?: AIStage): Promise<boolean> {
    const hasSharedConfiguration =
      commonForm.configured ||
      Boolean(
        commonForm.providerName.trim() ||
          commonForm.baseUrl.trim() ||
          commonForm.modelName.trim() ||
          commonForm.apiKey.trim(),
      );
    const activeForms =
      stage === "image_generation"
        ? [{ stage, ...forms.image_generation }]
        : [
            ...(commonMode
              ? hasSharedConfiguration
                ? CHAT_AI_STAGES.map((stage) => ({ stage, ...commonForm }))
                : []
              : CHAT_AI_STAGES.filter(
                  (stage) =>
                    forms[stage].configured ||
                    forms[stage].providerName.trim() ||
                    forms[stage].baseUrl.trim() ||
                    forms[stage].modelName.trim() ||
                    forms[stage].apiKey.trim(),
                ).map((stage) => ({ stage, ...forms[stage] }))),
            ...(forms.image_generation.configured ||
            forms.image_generation.apiKey.trim()
              ? [
                  {
                    stage: "image_generation" as const,
                    ...forms.image_generation,
                  },
                ]
              : []),
          ];

    if (activeForms.length === 0) {
      setError("Enter configuration for at least one AI stage.");
      return false;
    }
    if (!encryptionKeyConfigured) {
      setError("Set APP_ENCRYPTION_KEY in .env and restart the app before saving credentials.");
      return false;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    setTestResult(null);
    try {
      const response = await fetch("/api/ai/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          activeForms.map((form) => ({
            ...form,
            apiKey: form.apiKey || undefined,
            temperature: Number(form.temperature),
            maxOutputTokens: Number(form.maxOutputTokens),
            requestTimeoutMs: Number(form.requestTimeoutMs),
            retryLimit: Number(form.retryLimit),
          })),
        ),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(responseError(payload, "Could not save AI settings."));
      }
      const result = usableResponse(
        saveResponseSchema,
        payload,
        "The server returned invalid saved settings.",
      );
      const loadedForms = makeForms(result.configurations);
      if (stage === "image_generation") {
        setForms((current) => ({
          ...current,
          image_generation: loadedForms.image_generation,
        }));
      } else {
        setForms(loadedForms);
        setCommonForm({
          ...loadedForms.research,
          apiKey: "",
          hasApiKey: CHAT_AI_STAGES.every((stage) => loadedForms[stage].hasApiKey),
        });
      }
      setEncryptionKeyConfigured(true);
      setNotice(result.message);
      router.refresh();
      return true;
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save AI settings.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveAndTestImageConfiguration() {
    if (await saveSettings("image_generation")) {
      await testConnection("image_generation");
    }
  }

  async function testConnection(stage: AIStage) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setTestResult(null);
    setTestedStage(stage);
    try {
      const response = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(responseError(payload, "The connection test failed."));
      }
      const result = usableResponse(
        testResponseSchema,
        payload,
        "The provider response did not match the test result format.",
      );
      setTestResult(
        stage === "image_generation"
          ? `Connected to ${result.providerName} · ${result.configuredModel} · ${result.imageWidth ?? "?"}×${result.imageHeight ?? "?"} image · ${result.latencyMs} ms`
          : `Connected to ${result.providerName} · ${result.configuredModel} · ${result.latencyMs} ms · JSON mode: ${result.jsonMode}${
          result.tokenUsage?.total === null || result.tokenUsage === null
            ? ""
            : ` · ${result.tokenUsage.total} tokens`
          }`,
      );
    } catch (testError) {
      setError(
        testError instanceof Error
          ? testError.message
          : "The connection test failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-layout">
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>AI provider</h2>
            <p>
              Connect an OpenAI-compatible chat API. Image generation uses Playwright to open Gemini in your browser.
            </p>
          </div>
          <span className="metric-icon">
            <Waypoints size={17} />
          </span>
        </div>

        <div className="settings-status-row">
          <span className={`settings-status${configuredStages > 0 ? " is-configured" : ""}`}>
            <span className="status-dot" />
            {configuredStages} of {AI_STAGES.length} stages configured
          </span>
          <span className={`settings-status${encryptionKeyConfigured ? " is-configured" : " needs-attention"}`}>
            <span className="status-dot" />
            Encryption key {encryptionKeyConfigured ? "configured" : "required"}
          </span>
        </div>

        {!encryptionKeyConfigured && !loading && (
          <div className="settings-callout settings-warning">
            <KeyRound size={16} />
            <div>
              <strong>Credential encryption is not configured.</strong>
              <span>
                Add a unique 32-byte <code>APP_ENCRYPTION_KEY</code> to your
                server&apos;s <code>.env</code> file, then restart the app. A
                key-generation command is in the README.
              </span>
            </div>
          </div>
        )}

        <div className="settings-mode-row">
          <div>
            <strong>Use one provider across chat stages</strong>
            <span>
              Share one provider across text stages; image generation uses Playwright + Gemini.
            </span>
          </div>
          <label className="toggle-control">
            <input
              aria-label="Use one shared AI configuration for chat stages"
              type="checkbox"
              checked={commonMode}
              onChange={(event) => {
                if (
                  event.currentTarget.checked &&
                  !stageConfigurationsEqual(forms)
                ) {
                  setCommonForm({
                    ...forms.research,
                    apiKey: "",
                    hasApiKey: CHAT_AI_STAGES.every((stage) => forms[stage].hasApiKey),
                  });
                }
                setCommonMode(event.currentTarget.checked);
              }}
            />
            <span />
          </label>
        </div>

        {loading ? (
          <div className="settings-loading">
            <LoaderCircle size={17} className="spinning" />
            Loading encrypted provider settings…
          </div>
        ) : commonMode ? (
          <div className="settings-fields">
            <div className="form-grid">
              <label>
                Provider name
                <input
                  autoComplete="organization"
                  placeholder="Custom OpenAI Compatible"
                  value={commonForm.providerName}
                  onChange={(event) =>
                    updateCommonForm("providerName", event.currentTarget.value)
                  }
                />
              </label>
              <label>
                Model name
                <input
                  autoComplete="off"
                  placeholder="Your configured model identifier"
                  value={commonForm.modelName}
                  onChange={(event) =>
                    updateCommonForm("modelName", event.currentTarget.value)
                  }
                />
              </label>
              <label className="form-field-wide">
                API base URL
                <input
                  autoComplete="url"
                  placeholder="https://api.example.com/v1"
                  type="url"
                  value={commonForm.baseUrl}
                  onChange={(event) =>
                    updateCommonForm("baseUrl", event.currentTarget.value)
                  }
                />
              </label>
              <label className="form-field-wide">
                API key
                <span className="secret-input-wrap">
                  <input
                    autoComplete="new-password"
                    placeholder={
                      commonForm.hasApiKey
                        ? "Saved and encrypted · enter a new key to rotate"
                        : "Paste your provider API key"
                    }
                    type={showKeys ? "text" : "password"}
                    value={commonForm.apiKey}
                    onChange={(event) =>
                      updateCommonForm("apiKey", event.currentTarget.value)
                    }
                  />
                  <button
                    className="secret-visibility"
                    type="button"
                    aria-label={showKeys ? "Hide API key" : "Show API key"}
                    onClick={() => setShowKeys((visible) => !visible)}
                  >
                    {showKeys ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </span>
                <span className="field-note">
                  Keys are encrypted with AES-256-GCM and never sent back to this
                  browser.
                </span>
              </label>
              <label>
                Temperature
                <input
                  max={2}
                  min={0}
                  step={0.1}
                  type="number"
                  value={commonForm.temperature}
                  onChange={(event) =>
                    updateCommonForm("temperature", event.currentTarget.valueAsNumber)
                  }
                />
              </label>
              <label>
                Maximum output tokens
                <input
                  max={200000}
                  min={1}
                  step={256}
                  type="number"
                  value={commonForm.maxOutputTokens}
                  onChange={(event) =>
                    updateCommonForm("maxOutputTokens", event.currentTarget.valueAsNumber)
                  }
                />
              </label>
              <label>
                Request timeout (ms)
                <input
                  max={300000}
                  min={1000}
                  step={1000}
                  type="number"
                  value={commonForm.requestTimeoutMs}
                  onChange={(event) =>
                    updateCommonForm("requestTimeoutMs", event.currentTarget.valueAsNumber)
                  }
                />
              </label>
              <label>
                Retry limit
                <input
                  max={10}
                  min={0}
                  type="number"
                  value={commonForm.retryLimit}
                  onChange={(event) =>
                    updateCommonForm("retryLimit", event.currentTarget.valueAsNumber)
                  }
                />
              </label>
            </div>
          </div>
        ) : (
          <div className="stage-config-list">
            {CHAT_AI_STAGES.map((stage) => (
              <article className="stage-config-card" key={stage}>
                <div className="stage-config-heading">
                  <div>
                    <strong>{stageDetails[stage].label}</strong>
                    <span>{stageDetails[stage].description}</span>
                  </div>
                  <span className={`stage-config-state${forms[stage].configured ? " is-configured" : ""}`}>
                    {forms[stage].configured ? "SAVED" : "NOT SET"}
                  </span>
                </div>
                <div className="form-grid stage-form-grid">
                  <label>
                    Provider name
                    <input
                      placeholder="Compatible API"
                      value={forms[stage].providerName}
                      onChange={(event) =>
                        updateForm(stage, "providerName", event.currentTarget.value)
                      }
                    />
                  </label>
                  <label>
                    Model name
                    <input
                      placeholder="Model identifier"
                      value={forms[stage].modelName}
                      onChange={(event) =>
                        updateForm(stage, "modelName", event.currentTarget.value)
                      }
                    />
                  </label>
                  <label className="form-field-wide">
                    API base URL
                    <input
                      type="url"
                      placeholder="https://api.example.com/v1"
                      value={forms[stage].baseUrl}
                      onChange={(event) =>
                        updateForm(stage, "baseUrl", event.currentTarget.value)
                      }
                    />
                  </label>
                  <label className="form-field-wide">
                    API key
                    <span className="secret-input-wrap">
                      <input
                        autoComplete="new-password"
                        placeholder={
                          forms[stage].hasApiKey
                            ? "Saved and encrypted · blank keeps existing key"
                            : "Provider API key"
                        }
                        type={showKeys ? "text" : "password"}
                        value={forms[stage].apiKey}
                        onChange={(event) =>
                          updateForm(stage, "apiKey", event.currentTarget.value)
                        }
                      />
                      <button
                        className="secret-visibility"
                        type="button"
                        aria-label={showKeys ? "Hide API key" : "Show API key"}
                        onClick={() => setShowKeys((visible) => !visible)}
                      >
                        {showKeys ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </span>
                  </label>
                  <label>
                    Temperature
                    <input
                      max={2}
                      min={0}
                      step={0.1}
                      type="number"
                      value={forms[stage].temperature}
                      onChange={(event) =>
                        updateForm(stage, "temperature", event.currentTarget.valueAsNumber)
                      }
                    />
                  </label>
                  <label>
                    Maximum output tokens
                    <input
                      max={200000}
                      min={1}
                      step={256}
                      type="number"
                      value={forms[stage].maxOutputTokens}
                      onChange={(event) =>
                        updateForm(stage, "maxOutputTokens", event.currentTarget.valueAsNumber)
                      }
                    />
                  </label>
                  <label>
                    Request timeout (ms)
                    <input
                      max={300000}
                      min={1000}
                      step={1000}
                      type="number"
                      value={forms[stage].requestTimeoutMs}
                      onChange={(event) =>
                        updateForm(stage, "requestTimeoutMs", event.currentTarget.valueAsNumber)
                      }
                    />
                  </label>
                  <label>
                    Retry limit
                    <input
                      max={10}
                      min={0}
                      type="number"
                      value={forms[stage].retryLimit}
                      onChange={(event) =>
                        updateForm(stage, "retryLimit", event.currentTarget.valueAsNumber)
                      }
                    />
                  </label>
                  {forms[stage].configured && (
                    <button
                      className="secondary-button stage-test-button"
                      type="button"
                      disabled={busy}
                      onClick={() => void testConnection(stage)}
                    >
                      Test {stageDetails[stage].label}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {!loading && (
          <article className="stage-config-card">
            <div className="stage-config-heading">
              <div>
                <strong>{stageDetails.image_generation.label}</strong>
                <span>{stageDetails.image_generation.description}</span>
              </div>
              <span className={`stage-config-state${forms.image_generation.configured ? " is-configured" : ""}`}>
                {forms.image_generation.configured ? "SAVED" : "NOT SET"}
              </span>
            </div>
            <div className="settings-callout">
              <Sparkles size={16} />
              <div>
                <strong>Semi-automated via Playwright + Gemini</strong>
                <span>
                  Clicking &ldquo;Generate image&rdquo; on the Images page opens
                  Gemini in a persistent browser window (using Playwright) with
                  the prompt pre-copied. Generate your image in Gemini, then
                  download it and upload it back here. No API key is required for
                  this stage.
                </span>
              </div>
            </div>
            <div className="form-grid stage-form-grid">
              <label>
                Browser profile directory
                <input
                  autoComplete="off"
                  className="research-select"
                  placeholder="storage/browser-data (default)"
                  value={forms.image_generation.baseUrl === "https://gemini.google.com/app" ? "" : forms.image_generation.baseUrl}
                  onChange={(event) =>
                    updateForm("image_generation", "baseUrl", event.currentTarget.value || "https://gemini.google.com/app")
                  }
                />
                <span className="field-note">
                  Leave blank to use the default <code>storage/browser-data</code> profile.
                  Sign into Google once in this Playwright window to stay logged in.
                </span>
              </label>
              <button
                className="secondary-button stage-test-button"
                type="button"
                disabled={busy || loading}
                onClick={() => void saveAndTestImageConfiguration()}
              >
                {busy && testedStage === "image_generation" ? (
                  <LoaderCircle size={15} className="spinning" />
                ) : (
                  <Sparkles size={15} />
                )}
                Test browser automation
              </button>
              <span className="field-note form-field-wide">
                Checks that Playwright can locate the browser executable. No
                image generation request is made during this test.
              </span>
            </div>
          </article>
        )}

        <div className="settings-actions">
          <div className="settings-action-note">
            <ShieldCheck size={15} />
            Server-side keys are never included in settings responses or logs.
          </div>
          <div className="settings-action-buttons">
            {!commonMode && configuredStages > 0 && (
              <select
                aria-label="Choose stage to test"
                className="test-stage-select"
                value={testedStage}
                onChange={(event) => setTestedStage(event.currentTarget.value as AIStage)}
              >
                {AI_STAGES.filter((stage) => forms[stage].configured).map((stage) => (
                  <option value={stage} key={stage}>
                    {stageDetails[stage].label}
                  </option>
                ))}
              </select>
            )}
            {(commonMode
              ? commonForm.configured || AI_STAGES.some((stage) => forms[stage].configured)
              : forms[testedStage].configured) && (
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() =>
                  void testConnection(commonMode ? "research" : testedStage)
                }
              >
                {busy && testedStage === (commonMode ? "research" : testedStage) ? (
                  <LoaderCircle size={15} className="spinning" />
                ) : (
                  <Sparkles size={15} />
                )}
                Test real connection
              </button>
            )}
            <button
              className="primary-button"
              type="button"
              disabled={busy || loading || !encryptionKeyConfigured}
              onClick={() => void saveSettings()}
            >
              {busy ? <LoaderCircle size={15} className="spinning" /> : <Save size={15} />}
              Save configuration
            </button>
          </div>
        </div>

        {error && (
          <p className="feedback-message feedback-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="feedback-message feedback-success" role="status">
            <Check size={14} /> {notice}
          </p>
        )}
        {testResult && (
          <p className="feedback-message feedback-success" role="status">
            <Check size={14} /> {testResult}
          </p>
        )}
      </section>

      <aside className="panel provider-guidance">
        <div className="guidance-icon"><ShieldCheck size={17} /></div>
        <h2>Credential safety</h2>
        <p>
          AES-256-GCM encryption uses the server-only
          <code> APP_ENCRYPTION_KEY</code>. Keep a secure backup of that key:
          credentials cannot be recovered if it is lost.
        </p>
        <div className="guidance-divider" />
        <h3>Connection test</h3>
        <p>
          The test sends a real completion request to your chosen model and
          verifies a structured JSON result. An HTTP success alone does not count
          as a successful test.
        </p>
        <div className="guidance-divider" />
        <p className="guidance-small">
          A blank key field keeps the encrypted key already stored for that
          stage. Enter a replacement only when rotating credentials.
        </p>
      </aside>
    </div>
  );
}
