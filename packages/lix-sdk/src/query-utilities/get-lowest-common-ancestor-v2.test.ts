import { test, expect } from "vitest";
import { openLixInMemory } from "../open/openLixInMemory.js";
import { newLixFile } from "../newLix.js";
import type { Change, ChangeGraphEdge, NewChange } from "../database/schema.js";
import { getLowestCommonAncestorV2 } from "./get-lowest-common-ancestor-v2.js";

test("it should find the common parent of two changes recursively", async () => {
	const lix = await openLixInMemory({
		blob: await newLixFile(),
	});

	const mockChanges = [
		{
			id: "common",
			entity_id: "value1",
			file_id: "mock",
			plugin_key: "mock",
			type: "mock",
			created_at: "mock",
			snapshot_id: "no-content",
		},
		{
			id: "1",
			entity_id: "value1",
			file_id: "mock",
			plugin_key: "mock",
			type: "mock",
			created_at: "mock",
			snapshot_id: "no-content",
		},
		{
			id: "2",
			file_id: "mock",
			entity_id: "value1",
			plugin_key: "mock",
			type: "mock",
			created_at: "mock",
			snapshot_id: "no-content",
		},
		{
			id: "3",
			file_id: "mock",
			entity_id: "value1",
			plugin_key: "mock",
			type: "mock",
			created_at: "mock",
			snapshot_id: "no-content",
		},
	] as const satisfies Change[];

	const edges = [
		{ parent_id: "common", child_id: "1" },
		{ parent_id: "common", child_id: "3" },
		// for re-assurance that the function is not
		// just yielding the first parent
		{ parent_id: "1", child_id: "2" },
	];

	await lix.db.insertInto("change").values(mockChanges).execute();

	await lix.db.insertInto("change_graph_edge").values(edges).execute();

	const commonAncestor = await getLowestCommonAncestorV2({
		lix,
		changeA: mockChanges[1],
		changeB: mockChanges[3],
	});

	expect(commonAncestor?.id).toBe("common");
});

test("it should return undefind if no common parent exists", async () => {
	const lix = await openLixInMemory({
		blob: await newLixFile(),
	});

	const mockChanges: NewChange[] = [
		{
			id: "0",
			entity_id: "value1",
			file_id: "mock",
			plugin_key: "mock",
			type: "mock",
			snapshot_id: "no-content",
		},
		{
			id: "1",
			entity_id: "value1",
			file_id: "mock",
			plugin_key: "mock",
			type: "mock",
			snapshot_id: "no-content",
		},
		{
			id: "2",
			entity_id: "value2",
			file_id: "mock",
			plugin_key: "mock",
			type: "mock",
			snapshot_id: "no-content",
		},
	];

	await lix.db
		.insertInto("change")
		.values([mockChanges[0]!, mockChanges[1]!, mockChanges[2]!])
		.execute();

	await lix.db
		.insertInto("change_graph_edge")
		.values([{ parent_id: "0", child_id: "1" }])
		.execute();

	const changeA = await lix.db
		.selectFrom("change")
		.selectAll()
		.where("id", "=", mockChanges[2]!.id!)
		.executeTakeFirstOrThrow();

	const changeB = await lix.db
		.selectFrom("change")
		.selectAll()
		.where("id", "=", mockChanges[1]!.id!)
		.executeTakeFirstOrThrow();

	const commonAncestor = await getLowestCommonAncestorV2({
		lix,
		changeA,
		changeB,
	});

	expect(commonAncestor).toBe(undefined);
});

test("it should succeed if one of the given changes is the common ancestor", async () => {
	const lix = await openLixInMemory({
		blob: await newLixFile(),
	});

	const mockChanges = [
		{
			id: "0",
			entity_id: "value1",
			file_id: "mock",
			plugin_key: "mock",
			type: "mock",
			snapshot_id: "no-content",
			created_at: "mock",
		},
		{
			id: "1",
			entity_id: "value1",
			file_id: "mock",
			plugin_key: "mock",
			type: "mock",
			snapshot_id: "no-content",
			created_at: "mock",
		},
	] as const satisfies Change[];

	const edges: ChangeGraphEdge[] = [{ parent_id: "0", child_id: "1" }];

	await lix.db
		.insertInto("change")
		.values([mockChanges[0]!, mockChanges[1]!])
		.execute();

	await lix.db.insertInto("change_graph_edge").values(edges).execute();

	const commonAncestor = await getLowestCommonAncestorV2({
		lix,
		changeA: mockChanges[0],
		changeB: mockChanges[1],
	});

	expect(commonAncestor?.id).toBe("0");
});
