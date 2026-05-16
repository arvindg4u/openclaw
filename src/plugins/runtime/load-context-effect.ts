import { Context, Effect, Layer } from "effect";

import { runOpenClawEffectSync, syncEffect } from "../../effect-runtime/index.js";
import type { PluginLoadOptions } from "../loader.js";
import {
  buildPluginRuntimeLoadOptions,
  resolvePluginRuntimeLoadContext,
  type PluginRuntimeLoadContext,
  type PluginRuntimeLoadContextOptions,
} from "./load-context.js";

export const PluginRuntimeLoadContextTag =
  Context.GenericTag<PluginRuntimeLoadContext>("openclaw/PluginRuntimeLoadContext");

export function pluginRuntimeLoadContextLayer(
  options?: PluginRuntimeLoadContextOptions,
): Layer.Layer<PluginRuntimeLoadContext> {
  return Layer.effect(
    PluginRuntimeLoadContextTag,
    syncEffect({
      try: () => resolvePluginRuntimeLoadContext(options),
    }),
  );
}

export function pluginRuntimeLoadContextValueLayer(
  context: PluginRuntimeLoadContext,
): Layer.Layer<PluginRuntimeLoadContext> {
  return Layer.succeed(PluginRuntimeLoadContextTag, context);
}

export function buildPluginRuntimeLoadOptionsEffect(
  overrides?: Partial<PluginLoadOptions>,
): Effect.Effect<PluginLoadOptions, never, PluginRuntimeLoadContext> {
  return Effect.map(PluginRuntimeLoadContextTag, (context) =>
    buildPluginRuntimeLoadOptions(context, overrides),
  );
}

export function resolvePluginRuntimeLoadContextWithEffect(
  options?: PluginRuntimeLoadContextOptions,
): PluginRuntimeLoadContext {
  return runOpenClawEffectSync(
    PluginRuntimeLoadContextTag.pipe(Effect.provide(pluginRuntimeLoadContextLayer(options))),
  );
}

export function buildPluginRuntimeLoadOptionsWithEffect(
  context: PluginRuntimeLoadContext,
  overrides?: Partial<PluginLoadOptions>,
): PluginLoadOptions {
  return runOpenClawEffectSync(
    buildPluginRuntimeLoadOptionsEffect(overrides).pipe(
      Effect.provide(pluginRuntimeLoadContextValueLayer(context)),
    ),
  );
}
