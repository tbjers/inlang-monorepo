import type { NodeishFilesystem } from "@lix-js/fs";
import { findRepoRoot } from "@lix-js/client";
import { type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import * as yaml from "js-yaml"; // Assuming you have a YAML parsing library
import { GitHubActionsWorkflow } from "./types.js";

/**
 * Checks if the Ninja i18n GitHub Action is adopted within the GitHub workflow files.
 * @param {Object} args - The arguments object.
 * @param {NodeishFilesystem} args.fs - The filesystem to use for operations.
 * @returns {Promise<boolean>} - A promise that resolves to true if the action is adopted, otherwise false.
 */
export async function shouldRecommend(args: {
  fs: NodeishFilesystem;
}): Promise<boolean> {
  try {
    const gitConfigPath =
      (await relativePathStringFromRoot(args.fs)) + ".git/config";
    // Check if the .git/config file exists
    await args.fs.stat(gitConfigPath);

    // Read the .git/config file
    const configData = await args.fs.readFile(gitConfigPath, {
      encoding: "utf-8",
    });
    const match = configData.match(/url = (.+)/);
    const remoteOriginUrl = match ? match[1] : undefined;

    // Check if the URL is a GitHub URL
    const isNinjaAdopted = await isAdopted({ fs: args.fs });
    if (
      remoteOriginUrl &&
      remoteOriginUrl.includes("github.com") &&
      !isNinjaAdopted
    ) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    // Fail silently and return false for any error
    return false;
  }
}

/**
 *
 * @param {Object} args - The arguments object.
 * @param {NodeishFilesystem} args.fs - The filesystem to use for operations.
 * @returns {Promise<boolean>} - A promise that resolves to true if the action is adopted, otherwise false.
 */
export async function isAdopted(args: {
  fs: NodeishFilesystem;
}): Promise<boolean> {
  // Helper function for recursive search
  async function searchWorkflowFiles(
    directoryPath: string,
    depth: number = 0,
  ): Promise<boolean> {
    if (depth > 3) {
      // Limit recursion depth to 3 levels
      return false;
    }

    try {
      await args.fs.stat(directoryPath);
    } catch (error) {
      return false;
    }

    const items = await args.fs.readdir(directoryPath);
    for (const item of items) {
      const itemPath = `${directoryPath}/${item}`;
      const stats = await args.fs.stat(itemPath);
      if (stats.isDirectory()) {
        // Recursive call to search within the directory
        if (await searchWorkflowFiles(itemPath, depth + 1)) {
          return true; // Found in a deeper level
        }
      } else if (item.endsWith(".yml") || item.endsWith(".yaml")) {
        const fileContents = await args.fs.readFile(itemPath, {
          encoding: "utf-8",
        });
        const workflow = yaml.load(fileContents) as Static<
          typeof GitHubActionsWorkflow
        >;
        if (
          Value.Check(GitHubActionsWorkflow, workflow) &&
          workflow &&
          workflow.jobs
        ) {
          for (const jobKey in workflow.jobs) {
            const job = workflow.jobs[jobKey];
            if (job && job.steps) {
              for (const step of job.steps) {
                if (
                  step.uses &&
                  step.uses.includes("opral/ninja-i18n-action")
                ) {
                  return true; // Found the action
                }
              }
            }
          }
        }
      }
    }

    // Not found at this level or any deeper level
    return false;
  }

  // Start the search from the workflow directory
  return await searchWorkflowFiles(
    (await relativePathStringFromRoot(args.fs)) + ".github/workflows",
  );
}

/**
 * Adds the Ninja i18n GitHub Action workflow to the repository.
 * @param {Object} args - The arguments object.
 * @param {NodeishFilesystem} args.fs - The filesystem to use for operations.
 * @returns {Promise<void>} - A promise that resolves when the action workflow is successfully added.
 */
export async function add(args: { fs: NodeishFilesystem }): Promise<void> {
  const workflowDirPath =
    (await relativePathStringFromRoot(args.fs)) + ".github/workflows";
  const workflowFilePath = `${workflowDirPath}/ninja_i18n.yml`;
  const ninjaI18nWorkflowYaml = `
name: Ninja i18n action

on: pull_request_target

# explicitly configure permissions, in case your GITHUB_TOKEN workflow permissions are set to read-only in repository settings
permissions:
  pull-requests: write # Necessary to comment on PRs
  issues: read         # Necessary to read issue comments
  contents: read       # Necessary to access the repo content

jobs:
  ninja-i18n:
    name: Ninja i18n - GitHub Lint Action
    runs-on: ubuntu-latest

    steps:
      - name: Run Ninja i18n
        # @main ensures that the latest version of the action is used
        uses: opral/ninja-i18n-action@main
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
    `;

  // Ensure the workflow directory exists
  let workflowDirExists = false;
  try {
    await args.fs.stat(workflowDirPath);
  } catch (error) {
    workflowDirExists = false;
  }

  if (!workflowDirExists) {
    try {
      await args.fs.mkdir(workflowDirPath, { recursive: true });
    } catch (error) {
      console.error("Failed to create the workflow directory", error);
      throw error;
    }
  }

  // Write the Ninja i18n workflow YAML to the file
  await args.fs.writeFile(workflowFilePath, ninjaI18nWorkflowYaml);
}

async function relativePathStringFromRoot(
  fs: NodeishFilesystem,
): Promise<string> {
  const repoRoot = await findRepoRoot({
    nodeishFs: fs,
    path: process.cwd(),
  });
  const repoRootPath = repoRoot?.replace("file://", "") ?? "";
  const currentWorkingDirectory = process.cwd();
  const directoriesAboveRepoRootLength =
    currentWorkingDirectory.replace(repoRootPath, "").split("/").length - 1;
  return "../".repeat(directoriesAboveRepoRootLength);
}
