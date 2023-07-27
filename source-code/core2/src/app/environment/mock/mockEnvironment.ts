import { createMemoryFs, normalizePath } from "@inlang-git/fs"
import { dedent } from "ts-dedent"
import type { InlangInstanceEnvironment } from "../api.js"
import { create$import } from "../$import.js"

/**
 * Initializes a mock environment.
 *
 * The mock environment uses a virtual file system (memoryFs). If
 * testing inlang depends on files in the local file system,
 * you can copy directories into the environment by providing
 * the `copyDirectory` argument.
 *
 * @param copyDirectory - if defined, copies directories (paths) into the environment
 */
export async function createMockEnvironment(args: {
	copyDirectory?: {
		fs: InlangInstanceEnvironment["$fs"]
		paths: string[]
	}
}): Promise<InlangInstanceEnvironment> {
	const $fs = createMemoryFs()
	const $import = create$import({
		fs: $fs,
		fetch,
	})
	const env = {
		$fs,
		$import,
	}
	if (args.copyDirectory) {
		for (const path of args.copyDirectory.paths) {
			await copyDirectory({ copyFrom: args.copyDirectory.fs, copyTo: $fs, path })
		}
	}
	return env
}

/**
 * Copies a directory from one fs to another.
 *
 * Useful for mocking the environment.
 */
export async function copyDirectory(args: {
	copyFrom: InlangInstanceEnvironment["$fs"]
	copyTo: InlangInstanceEnvironment["$fs"]
	path: string
}) {
	try {
		await args.copyFrom.readdir(args.path)
	} catch {
		throw new Error(dedent`
The directory specified in \`copyDirectory.path\` "${args.path}" does not exist.

Solution: Make sure that the \`copyDirectory.path\` is relative to the current working directory.

Context: The path is relative to the current working directory, not the file that calls \`mockEnvironment\`.
		`)
	}
	// create directory
	await args.copyTo.mkdir(args.path, { recursive: true })
	const pathsInDirectory = await args.copyFrom.readdir(args.path)
	for (const subpath of pathsInDirectory) {
		// check if the path is a file
		const path = normalizePath(`${args.path}/${subpath}`)
		try {
			const file = await args.copyFrom.readFile(path, { encoding: "binary" })
			await args.copyTo.writeFile(path, file)
		} catch (err) {
			await copyDirectory({ ...args, path })
		}
	}
}
