import fs from "node:fs/promises";
import { MarketplaceManifest } from "@inlang/marketplace-manifest";
import { Value } from "@sinclair/typebox/value";
import algoliasearch from "algoliasearch";
import fetch from "node-fetch";

// eslint-disable-next-line no-undef
const envVariables = process.env;

const repositoryRoot = import.meta.url.slice(
  0,
  import.meta.url.lastIndexOf("inlang/source-code"),
);
const manifestLinks = JSON.parse(await fs.readFile("./registry.json", "utf-8"));

/** @type {(import("@inlang/marketplace-manifest").MarketplaceManifest)[]} */
const manifests = [];

for (const type of Object.keys(manifestLinks)) {
  let json;
  // eslint-disable-next-line no-undef
  console.info(`Fetching ${type} manifests...`);

  for (const uniqueID of Object.keys(manifestLinks[type])) {
    const link = manifestLinks[type][uniqueID];

    try {
      if (link.includes("http")) {
        json = JSON.parse(await fetch(link).then((res) => res.text()));
      } else {
        // eslint-disable-next-line no-undef
        json = JSON.parse(
          await fs.readFile(new URL(link, repositoryRoot), "utf-8"),
        );
      }

      if (Value.Check(MarketplaceManifest, json) === false) {
        const errors = [...Value.Errors(MarketplaceManifest, json)];
        // eslint-disable-next-line no-undef
        console.error(errors);
        throw new Error(`Manifest is invalid.`);
      }

      manifests.push({
        uniqueID,
        ...json,
      });
    } catch (e) {
      throw new Error(`Manifest '${link}' is invalid.`);
    }
  }
}

// checks if every manifest has a unique id
checkUniqueIDs(manifests);

// checks if the module links have the correct schema
checkModuleLinks(manifests);

// sort the manifests by id
manifests.sort((a, b) => {
  if (a.id.toUpperCase() < b.id.toUpperCase()) return -1;
  if (a.id.toUpperCase() > b.id.toUpperCase()) return 1;
  return 0;
});

await fs.writeFile(
  "./src/registry.ts",
  `
	//! Do not edit this file manually. It is automatically generated based on the contents of the registry.json file.
	
	import type { MarketplaceManifest } from "@inlang/marketplace-manifest"
	export type Registry = MarketplaceManifest & { uniqueID: string };

	export const registry: Registry[] = ${JSON.stringify(
    manifests.map((manifest) => ({ ...manifest, uniqueID: manifest.uniqueID })),
    undefined,
    "\t",
  )}`,
);

if (envVariables.DOPPLER_ENVIRONMENT === "production") {
  const client = algoliasearch(
    envVariables.ALGOLIA_APPLICATION,
    envVariables.ALGOLIA_ADMIN,
  );
  const index = client.initIndex("registry");

  const objects = await Promise.all(
    [...manifests.values()].map(async (value) => {
      const { uniqueID, ...rest } = value;

      let readme = undefined;
      if (value.pages) {
        if (value.pages["/"]) {
          readme = () => {
            return value.pages["/"];
          };
        } else {
          if (
            Object.values(value.pages).some(
              (namespace) => typeof namespace === "object" && namespace["/"],
            )
          ) {
            readme = () => {
              return Object.values(value.pages).find(
                (namespace) => typeof namespace === "object" && namespace["/"],
              )["/"];
            };
          } else {
            throw new Error(`No page at "/" found for ${value.id}`);
          }
        }
      } else if (value.readme) {
        readme = () => {
          return typeof value.readme === "object"
            ? value.readme.en
            : value.readme;
        };
      } else {
        throw new Error(`No readme found for ${value.id}`);
      }

      const text = await (readme().includes("http")
        ? (await fetch(readme())).text()
        : // eslint-disable-next-line no-undef
          await fs.readFile(new URL(readme(), repositoryRoot), "utf-8"));

      return { objectID: uniqueID, readme: text, ...rest };
    }),
  );

  index
    .saveObjects(objects)
    .then(() => {
      // eslint-disable-next-line no-undef
      console.info("Successfully uploaded registry on Algolia");
    })
    .catch((err) => {
      // eslint-disable-next-line no-undef
      console.error(err);
    });
}

/* This function checks for uniqueIDs to verify they are not duplicated */
function checkUniqueIDs(manifests) {
  const uniqueIDs = new Set();

  for (const manifest of manifests) {
    if (uniqueIDs.has(manifest.uniqueID)) {
      throw new Error(
        `Manifest with unique id '${manifest.uniqueID}' already exists.`,
      );
    }
    uniqueIDs.add(manifest.uniqueID);
  }
}

/* This function checks for the module links to have the correct schema */
function checkModuleLinks(manifests) {
  for (const manifest of manifests) {
    if (manifest.module !== undefined) {
      // should be in this schema https://cdn.jsdelivr.net/npm/PUBLISHER/NAME@latest/PATH
      if (!manifest.module.startsWith("https://cdn.jsdelivr.net/npm/")) {
        throw new Error(
          `Module link '${manifest.module}' does not start with 'https://cdn.jsdelivr.net/npm/'.`,
        );
      } else if (!manifest.module.includes("@latest")) {
        throw new Error(
          `Module link '${manifest.module}' does not include a package name.`,
        );
      }
    }
  }
}
