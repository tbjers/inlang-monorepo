import type { Message } from "@inlang/messages"
import { ReactiveMap } from "@solid-primitives/map"
import { createEffect } from "./solid.js"
import { createSubscribable } from "./openInlangProject.js"
import type { InlangProject, InstalledLintRule, LintReportsQueryApi } from "./api.js"
import type { InlangConfig } from "@inlang/config"
import { LintReport, lintMessages } from "@inlang/lint"
import type { JSONObject } from "@inlang/plugin"
import type { ResolvePackagesFunction } from "@inlang/package"

/**
 * Creates a reactive query API for messages.
 */
export function createLintReportsQuery(
	messages: () => Array<Message> | undefined,
	config: () => InlangConfig | undefined,
	installedLintRules: () => Array<InstalledLintRule>,
	resolvedModules: () => Awaited<ReturnType<ResolvePackagesFunction>> | undefined,
): InlangProject["query"]["lintReports"] {
	const index = new ReactiveMap<LintReport["messageId"], LintReport[]>()

	createEffect(() => {
		const msgs = messages()
		const conf = config()
		const modules = resolvedModules()

		if (msgs && conf && modules) {
			// console.log("new calculation")
			// index.clear()
			for (const message of msgs) {
				// TODO: only lint changed messages and update arrays selectively
				lintMessages({
					sourceLanguageTag: conf.sourceLanguageTag,
					languageTags: conf.languageTags,
					lintRuleSettings: conf.settings as Record<`${string}.lintRule.${string}`, JSONObject>,
					lintLevels: Object.fromEntries(
						installedLintRules().map((rule) => [rule.meta.id, rule.lintLevel]),
					),
					messages: [message],
					lintRules:
						conf.settings["project.disabled"] !== undefined
							? modules.lintRules.filter(
									(rule) => conf.settings["project.disabled"]?.includes(rule.meta.id) === false,
							  )
							: modules.lintRules,
				}).then((report) => {
					if (
						report.errors.length === 0 &&
						JSON.stringify(index.get(message.id)) !== JSON.stringify(report.data)
					) {
						// console.log("get index", index.get(message.id))
						// console.log(report.data)
						// console.log("set index", message.id)
						index.set(message.id, report.data || [])
					}
				})
			}
		}
	})

	const get = (args: Parameters<LintReportsQueryApi["get"]>[0]) => {
		return structuredClone(index.get(args.where.messageId))
	}

	return {
		getAll: createSubscribable(() => {
			return structuredClone(
				[...index.values()].flat().length === 0 ? undefined : [...index.values()].flat(),
			)
		}),
		get: Object.assign(get, {
			subscribe: (
				args: Parameters<LintReportsQueryApi["get"]["subscribe"]>[0],
				callback: Parameters<LintReportsQueryApi["get"]["subscribe"]>[1],
			) => createSubscribable(() => get(args)).subscribe(callback),
		}) as any,
	}
}
