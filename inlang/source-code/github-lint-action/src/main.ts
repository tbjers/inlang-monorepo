import * as fs from "node:fs/promises"
import * as core from "@actions/core"
import * as github from "@actions/github"
import { openRepository } from "@lix-js/client"
import {
	loadProject,
	type InstalledMessageLintRule,
	type MessageLintReport,
	listProjects,
} from "@inlang/sdk"
import { exec } from "node:child_process"

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
	core.debug("Running the action")

	try {
		const token = process.env.GITHUB_TOKEN
		if (!token) {
			throw new Error("GITHUB_TOKEN is not set")
		}
		const { owner, repo } = github.context.repo
		const pr_number = github.context.payload.pull_request?.number

		const repoBase = await openRepository(process.cwd(), {
			nodeishFs: fs,
			branch: github.context.payload.pull_request?.head.ref,
		})
		const projectListBase = await listProjects(repoBase.nodeishFs, process.cwd())
		const results = projectListBase.map((project) => ({
			projectPath: project.projectPath,
			errorsBase: [] as any[],
			errorsHead: [] as any[],
			installedRules: [] as InstalledMessageLintRule[],
			reportsBase: [] as MessageLintReport[],
			reportsHead: [] as MessageLintReport[],
			lintSummary: [] as { id: string; name: string; count: number }[],
			commentContent: "" as string,
		}))

		// Collect all reports from the base repository
		for (const project of projectListBase) {
			console.debug("Checking project:", project.projectPath)
			const result = results.find((result) => result.projectPath === project.projectPath)
			// eslint-disable-next-line prefer-const
			let projectBase = await loadProject({
				projectPath: process.cwd() + project.projectPath,
				repo: repoBase,
				appId: "app.inlang.githubI18nLintAction",
			})
			if (projectBase.errors().length > 0) {
				if (result) result.errorsBase = projectBase.errors()
				console.debug("Skip project ", project.projectPath, " because of errors")
				continue
			}
			result?.installedRules.push(...projectBase.installed.messageLintRules())
			result?.reportsBase.push(...projectBase.query.messageLintReports.getAll())
		}

		// Collect meta data for head and base repository
		const headMeta = {
			owner: github.context.payload.pull_request?.head.label.split(":")[0],
			repo: github.context.payload.pull_request?.head.repo.name,
			branch: github.context.payload.pull_request?.head.label.split(":")[1],
			link: github.context.payload.pull_request?.head.repo.html_url,
		}
		const baseMeta = {
			owner: github.context.payload.pull_request?.base.label.split(":")[0],
			repo: repo,
			branch: github.context.payload.pull_request?.base.label.split(":")[1],
			link: github.context.payload.pull_request?.base.repo.html_url,
		}

		const isFork = headMeta.owner !== baseMeta.owner
		core.debug(`Is fork: ${isFork}`)

		// Prepare base repo
		let repoHead
		if (isFork) {
			core.debug("Fork detected, cloning base repository")
			process.chdir("../../../")
			await cloneRepository(headMeta)
			process.chdir(headMeta.repo)
			repoHead = await openRepository(process.cwd(), {
				nodeishFs: fs,
			})
		} else {
			core.debug("Fork not detected, fetching and checking out base repository")
			await fetchBranch(headMeta.branch)
			await checkoutBranch(headMeta.branch)
			await pull()
			repoHead = await openRepository(process.cwd(), {
				nodeishFs: fs,
				branch: headMeta.branch,
			})
		}

		// Check if the head repository has a new project compared to the base repository
		const projectListHead = await listProjects(repoHead.nodeishFs, process.cwd())
		const newProjects = projectListHead.filter(
			(project) => !results.some((result) => result.projectPath === project.projectPath)
		)
		// Add new projects to the results
		for (const project of newProjects) {
			results.push({
				projectPath: project.projectPath,
				errorsBase: [] as any[],
				errorsHead: [] as any[],
				installedRules: [] as InstalledMessageLintRule[],
				reportsBase: [] as MessageLintReport[],
				reportsHead: [] as MessageLintReport[],
				lintSummary: [] as { id: string; name: string; count: number }[],
				commentContent: "" as string,
			})
		}

		// Collect all reports from the head repository
		for (const project of projectListHead) {
			const result = results.find((result) => result.projectPath === project.projectPath)
			const projectHead = await loadProject({
				projectPath: process.cwd() + project.projectPath,
				repo: repoHead,
				appId: "app.inlang.githubI18nLintAction",
			})
			if (projectHead.errors().length > 0) {
				if (result) result.errorsHead = projectHead.errors()
				console.debug("Skip project ", project.projectPath, " because of errors")
				continue
			}
			result?.reportsHead.push(...projectHead.query.messageLintReports.getAll())
		}

		// Create a lint summary for each project
		for (const result of results) {
			if (result.errorsBase.length > 0 || result.errorsHead.length > 0) continue
			result.lintSummary = createLintSummary(
				result.reportsHead,
				result.reportsBase,
				result.installedRules
			)
		}

		// Create a comment content for each project
		for (const result of results) {
			if (result.errorsBase.length > 0 && result.errorsHead.length === 0) {
				result.commentContent = `#### ✅ Setup of project \`${result.projectPath}\` fixed`
				continue
			}
			if (result.errorsBase.length === 0 && result.errorsHead.length > 0) {
				result.commentContent = `#### ❗️ New errors in setup of project \`${result.projectPath}\` found`
				continue
			}
			if (result.errorsBase.length > 0 || result.errorsHead.length > 0) continue
			const lintSummary = result.lintSummary
			const shortenedProjectPath = () => {
				const parts = result.projectPath.split("/")
				if (parts.length > 2) {
					return `/${parts.at(-2)}/${parts.at(-1)}`
				} else {
					return result.projectPath
				}
			}
			const commentContent = `#### Project: \`${shortenedProjectPath()}\`
| lint rule | new reports | link |
|-----------|-------------|------|
${lintSummary
	.map(
		(lintSummary) =>
			`| ${lintSummary.name} | ${lintSummary.count} | [contribute (via Fink 🐦)](https://fink.inlang.com/github.com/${headMeta.owner}/${headMeta.repo}?branch=${headMeta.branch}&project=${result.projectPath}&lint=${lintSummary.id}) |`
	)
	.join("\n")}
`
			result.commentContent = commentContent
		}

		const commentHeadline = `### 🛎️ Translations need to be updated`
		const commentContent =
			commentHeadline +
			"\n\n" +
			results
				.map((result) => result.commentContent)
				.filter((content) => content.length > 0)
				.join("\n")

		const octokit = github.getOctokit(token)
		const issue = await octokit.rest.issues.get({
			owner,
			repo,
			issue_number: pr_number as number,
		})
		if (issue.data.locked) return core.debug("PR is locked, skipping comment")

		//check if PR already has a comment from this action
		const existingComment = await octokit.rest.issues.listComments({
			owner,
			repo,
			issue_number: pr_number as number,
		})
		if (existingComment.data.length > 0) {
			const commentId = existingComment.data.find(
				(comment) =>
					comment.body?.includes(commentHeadline) && comment.user?.login === "github-actions[bot]"
			)?.id
			if (commentId) {
				core.debug("Updating existing comment")
				if (results.every((result) => result.lintSummary.length === 0)) {
					core.debug("Reports have been fixed, updating comment and removing it")
					await octokit.rest.issues.updateComment({
						owner,
						repo,
						comment_id: commentId,
						body: `### Translations have been successfully updated 🎉`,
					})
					return
				} else {
					core.debug("Reports have not been fixed, updating comment")
					await octokit.rest.issues.updateComment({
						owner,
						repo,
						comment_id: commentId,
						body: commentContent,
					})
				}
				return
			}
		}

		if (results.every((result) => result.lintSummary.length === 0)) {
			core.debug("No lint reports found, skipping comment")
			return
		}

		core.debug("Creating a new comment")
		await octokit.rest.issues.createComment({
			owner,
			repo,
			issue_number: pr_number as number,
			body: commentContent,
		})
	} catch (error) {
		// Fail the workflow run if an error occurs
		if (error instanceof Error) core.setFailed(error.message)
	}
}

export default run

function createLintSummary(
	reportsHead: MessageLintReport[],
	reportsBase: MessageLintReport[],
	installedRules: InstalledMessageLintRule[]
) {
	const summary: { id: string; name: string; count: number }[] = []
	const diffReports = reportsHead.filter(
		(report) =>
			!reportsBase.some(
				(baseReport) =>
					baseReport.ruleId === report.ruleId &&
					baseReport.languageTag === report.languageTag &&
					baseReport.messageId === report.messageId
			)
	)
	for (const installedRule of installedRules) {
		const id = installedRule.id
		const name =
			typeof installedRule.displayName === "object"
				? installedRule.displayName.en
				: installedRule.displayName
		const count = diffReports.filter((report) => report.ruleId === id).length
		if (count > 0) {
			summary.push({ id, name, count: count })
		}
	}
	return summary
}

// All functions below will be replaced by the @lix-js/client package in the future

// Function to checkout a branch
async function checkoutBranch(branchName: string) {
	return new Promise<void>((resolve, reject) => {
		// Execute the git command to checkout the branch
		exec(`git checkout ${branchName}`, { cwd: process.cwd() }, (error, stdout, stderr) => {
			if (error) {
				console.error(`Error executing command: ${error}`)
				reject(error)
				return
			}
			core.debug(`stdout: ${stdout}`)
			core.debug(`stderr: ${stderr}`)
			resolve()
		})
	})
}

// Function to fetch the branches
async function fetchBranch(branchName: string) {
	return new Promise<void>((resolve, reject) => {
		// Execute the git command to fetch the branch
		exec(`git fetch origin ${branchName}`, { cwd: process.cwd() }, (error, stdout, stderr) => {
			if (error) {
				console.error(`Error executing command: ${error}`)
				reject(error)
				return
			}
			core.debug(`stdout: ${stdout}`)
			core.debug(`stderr: ${stderr}`)
			resolve()
		})
	})
}

// Funtion to pull latest changes
async function pull() {
	return new Promise<void>((resolve, reject) => {
		// Execute the git command to pull the latest changes
		exec(`git pull`, { cwd: process.cwd() }, (error, stdout, stderr) => {
			if (error) {
				console.error(`Error executing command: ${error}`)
				reject(error)
				return
			}
			core.debug(`stdout: ${stdout}`)
			core.debug(`stderr: ${stderr}`)
			resolve()
		})
	})
}

// Function to clone the base repository
async function cloneRepository(repoData: { link: string; branch: string }) {
	return new Promise<void>((resolve, reject) => {
		// Execute the git command to clone the base repository
		exec(
			`git clone -b ${repoData.branch} --single-branch --depth 1 ${repoData.link}`, // Clone only the latest commit
			{ cwd: process.cwd() },
			(error, stdout, stderr) => {
				if (error) {
					console.error(`Error executing command: ${error}`)
					reject(error)
					return
				}
				core.debug(`stdout: ${stdout}`)
				core.debug(`stderr: ${stderr}`)
				resolve()
			}
		)
	})
}