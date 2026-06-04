import { createHash } from "node:crypto";
import type { Tool as OpenAITool } from "openai/resources/responses/responses.js";
import { resolveOpenAIStrictToolSetting } from "../../agents/openai-strict-tool-setting.js";
import {
  findOpenAIStrictToolSchemaDiagnostics,
  isStrictOpenAIJsonSchemaCompatible,
  normalizeOpenAIStrictToolParameters,
} from "../../agents/openai-tool-schema.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { Model, Tool } from "../types.js";

/** Options for converting internal tool schemas to OpenAI Responses function tools. */
export interface ConvertResponsesToolsOptions {
  strict?: boolean | null;
  model?: Model;
  supportsStrictMode?: boolean;
}

type OpenAIToolSchemaCompat = Parameters<typeof normalizeOpenAIStrictToolParameters>[2];
type ResponsesFunctionTool = {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict?: boolean | null;
};
type PreparedResponsesTool = {
  index: number;
  name: string;
  description: string;
  parameters: unknown;
  looseParameters: Record<string, unknown>;
  strictCompatible?: boolean;
  strictParameters?: Record<string, unknown>;
};

// Converts OpenClaw tool schemas to OpenAI Responses tools, including strict-mode compatibility.
const log = createSubsystemLogger("llm/openai-responses");
const MAX_STRICT_TOOL_DOWNGRADE_DIAGNOSTIC_KEYS = 64;
const loggedStrictToolDowngradeDiagnosticKeys = new Set<string>();

/** Converts tools to deterministic OpenAI Responses function tool definitions. */
export function convertResponsesTools(
  tools: Tool[],
  options?: ConvertResponsesToolsOptions,
): OpenAITool[] {
  const strictSetting = resolveResponsesStrictToolSetting(options);
  const modelCompat = options?.model?.compat as OpenAIToolSchemaCompat;
  const preparedTools = prepareResponsesTools(tools, strictSetting, modelCompat);
  const strict = resolveResponsesStrictToolFlag(preparedTools, strictSetting, options?.model);
  // Sort tools before request construction so prompt-cache bytes stay deterministic.
  return sortResponsesToolsByName(preparedTools).map((tool) => {
    const result: ResponsesFunctionTool = {
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters:
        strict === true ? (tool.strictParameters ?? tool.looseParameters) : tool.looseParameters,
    };
    if (strict !== undefined) {
      result.strict = strict;
    }
    return result as OpenAITool;
  });
}

function resolveResponsesStrictToolSetting(
  options: ConvertResponsesToolsOptions | undefined,
): boolean | null | undefined {
  if (options?.strict !== undefined) {
    return options.strict;
  }
  if (options?.model) {
    return resolveOpenAIStrictToolSetting(options.model, {
      transport: "stream",
      supportsStrictMode: options.supportsStrictMode,
    });
  }
  return false;
}

function prepareResponsesTools(
  tools: Tool[],
  strictSetting: boolean | null | undefined,
  modelCompat: OpenAIToolSchemaCompat | undefined,
): PreparedResponsesTool[] {
  const prepared: PreparedResponsesTool[] = [];
  for (const [index, tool] of tools.entries()) {
    let name: string;
    let description: string;
    let parameters: unknown;
    try {
      name = tool.name;
      description = tool.description;
      parameters = tool.parameters;
    } catch (error) {
      warnSkippedResponsesTool({ index, reason: "descriptor was unreadable", error });
      continue;
    }

    let looseParameters: Record<string, unknown>;
    try {
      looseParameters = normalizeOpenAIStrictToolParameters(
        parameters,
        false,
        modelCompat,
      ) as Record<string, unknown>;
    } catch (error) {
      warnSkippedResponsesTool({
        index,
        name,
        reason: "schema could not be normalized",
        error,
      });
      continue;
    }

    if (strictSetting !== true) {
      prepared.push({ index, name, description, parameters, looseParameters });
      continue;
    }

    let strictCompatible: boolean;
    try {
      strictCompatible = isStrictOpenAIJsonSchemaCompatible(parameters);
    } catch (error) {
      warnSkippedResponsesTool({
        index,
        name,
        reason: "schema could not be checked for strict mode",
        error,
      });
      continue;
    }

    let strictParameters: Record<string, unknown> | undefined;
    if (strictCompatible) {
      try {
        strictParameters = normalizeOpenAIStrictToolParameters(
          parameters,
          true,
          modelCompat,
        ) as Record<string, unknown>;
      } catch (error) {
        warnSkippedResponsesTool({
          index,
          name,
          reason: "schema could not be normalized for strict mode",
          error,
        });
        continue;
      }
    }

    prepared.push({
      index,
      name,
      description,
      parameters,
      looseParameters,
      strictCompatible,
      ...(strictParameters ? { strictParameters } : {}),
    });
  }
  return prepared;
}

function resolveResponsesStrictToolFlag(
  tools: PreparedResponsesTool[],
  strictSetting: boolean | null | undefined,
  model: Model | undefined,
): boolean | undefined {
  const strict =
    strictSetting === true
      ? tools.every((tool) => tool.strictCompatible === true)
      : strictSetting === false
        ? false
        : undefined;
  if (strictSetting === true && strict === false && model && log.isEnabled("debug", "any")) {
    const diagnostics = getStrictToolSchemaDiagnostics(tools);
    if (shouldLogStrictToolDowngradeDiagnostic(diagnostics, model)) {
      const sample = diagnostics.slice(0, 5).map((entry) => ({
        tool: entry.toolName ?? `tool[${entry.toolIndex}]`,
        violations: entry.violations.slice(0, 8),
      }));
      log.debug(
        `OpenAI responses tool schema strict mode downgraded to strict=false for ` +
          `${model.provider ?? "unknown"}/${model.id ?? "unknown"} because ` +
          `${diagnostics.length} tool schema(s) are not strict-compatible`,
        {
          provider: model.provider,
          model: model.id,
          incompatibleToolCount: diagnostics.length,
          sample,
        },
      );
    }
  }
  return strict;
}

function getStrictToolSchemaDiagnostics(
  tools: PreparedResponsesTool[],
): ReturnType<typeof findOpenAIStrictToolSchemaDiagnostics> {
  try {
    return findOpenAIStrictToolSchemaDiagnostics(tools);
  } catch (error) {
    log.warn(
      `failed to inspect OpenAI Responses strict tool schemas: ${formatUnknownError(error)}`,
    );
    return [];
  }
}

function shouldLogStrictToolDowngradeDiagnostic(
  diagnostics: ReturnType<typeof findOpenAIStrictToolSchemaDiagnostics>,
  model: Model,
): boolean {
  // Strict downgrade diagnostics can repeat per turn; hash details and cap memory.
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        provider: model.provider,
        model: model.id,
        diagnostics: diagnostics.map((entry) => ({
          toolIndex: entry.toolIndex,
          toolName: entry.toolName ?? null,
          violations: entry.violations,
        })),
      }),
    )
    .digest("hex");
  if (loggedStrictToolDowngradeDiagnosticKeys.has(key)) {
    return false;
  }
  if (loggedStrictToolDowngradeDiagnosticKeys.size >= MAX_STRICT_TOOL_DOWNGRADE_DIAGNOSTIC_KEYS) {
    loggedStrictToolDowngradeDiagnosticKeys.clear();
  }
  loggedStrictToolDowngradeDiagnosticKeys.add(key);
  return true;
}

function compareToolText(left: string | undefined, right: string | undefined): number {
  const leftText = left ?? "";
  const rightText = right ?? "";
  if (leftText < rightText) {
    return -1;
  }
  if (leftText > rightText) {
    return 1;
  }
  return 0;
}

function sortResponsesToolsByName<T extends { name?: string; description?: string }>(
  tools: readonly T[],
): T[] {
  return tools.toSorted(
    (left, right) =>
      compareToolText(left.name, right.name) ||
      compareToolText(left.description, right.description),
  );
}

function warnSkippedResponsesTool(params: {
  index: number;
  name?: string;
  reason: string;
  error: unknown;
}): void {
  const label = params.name ? `${params.name} (index ${params.index})` : `index ${params.index}`;
  log.warn(
    `skipping OpenAI Responses tool ${label}: ${params.reason}: ${formatUnknownError(params.error)}`,
  );
}

function formatUnknownError(error: unknown): string {
  try {
    return String(error);
  } catch {
    return "<unprintable error>";
  }
}
