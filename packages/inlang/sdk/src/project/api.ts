import type { Kysely } from "kysely";
import type { InlangDatabaseSchema } from "../database/schema.js";
import type { InlangPlugin } from "../plugin/schema.js";
import type { ProjectSettings } from "../json-schema/settings.js";
import type { Lix } from "@lix-js/sdk";
import type { SqliteDatabase } from "sqlite-wasm-kysely";

export type InlangProject = {
	db: Kysely<InlangDatabaseSchema>;
	/**
	 * @deprecated Don't use this. Only an internal hack to unblock
	 * fink v2.
	 *
	 * TODO remove this
	 */
	_sqlite: SqliteDatabase;
	id: {
		get: () => Promise<string>;
		subscribe: Subscription<string>;
	};
	plugins: {
		get: () => Promise<readonly InlangPlugin[]>;
		subscribe: Subscription<readonly InlangPlugin[]>;
	};
	errors: {
		get: () => Promise<readonly Error[]>;
		subscribe: Subscription<readonly Error[]>;
	};
	settings: {
		get: () => Promise<ProjectSettings>;
		set: (settings: ProjectSettings) => Promise<void>;
		subscribe: Subscription<ProjectSettings>;
	};
	lix: Lix;
	importFiles: (args: {
		pluginKey: InlangPlugin["key"];
		files: ImportFile[];
	}) => Promise<void>;
	exportFiles: (args: {
		pluginKey: InlangPlugin["key"];
	}) => Promise<ExportFile[]>;
	close: () => Promise<void>;
	toBlob: () => Promise<Blob>;
};

export type ImportFile = {
	/** The locale of the resource file */
	locale: string;
	/** The binary content of the resource */
	content: Uint8Array;
};

export type ExportFile = {
	/** The locale of the resource file */
	locale: string;
	/**
	 * The name of the file.
	 *
	 * @example
	 *   "en.json"
	 *   "common-de.json"
	 *
	 */
	name: string;
	/** The binary content of the resource */
	content: Uint8Array;
};

/**
 * Minimal RxJS compatible (generic) subscription type.
 */
export type Subscription<T> = (callback: (value: T) => void) => {
	unsubscribe: () => void;
};
