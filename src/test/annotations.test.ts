import * as assert from "assert";
import type { ChangeWithDetails } from "../types";
import { getExtensionAPI } from "./extensionApi";

suite("annotation hover", () => {
  const repositoryRoot = "/repo/with spaces";
  let buildAnnotationHover: (
    change: ChangeWithDetails,
    repositoryRoot: string,
  ) => import("vscode").MarkdownString;

  suiteSetup(async () => {
    ({ buildAnnotationHover } = (await getExtensionAPI()).annotations);
  });
  const change: ChangeWithDetails = {
    changeId: "qtwrprsuulrzpzlttpunwozkyyrokttt",
    commitId: "87668a5047ec4730da305283fb5af9aba0d13aa3",
    parentChangeIds: [],
    parentCommitIds: [],
    author: {
      name: "joshka",
      email: "joshka@users.noreply.github.com",
    },
    authoredDate: "2026-09-12 13:07:59",
    description: "Add hover details\n\nDo not run [commands](command:evil).",
    isEmpty: false,
    isConflict: false,
  };

  test("shows full commit metadata and a scoped copy command", () => {
    const hover = buildAnnotationHover(change, repositoryRoot);

    assert.ok(hover.value.includes("Add hover details"));
    assert.ok(hover.value.includes(change.changeId));
    assert.ok(hover.value.includes(change.commitId));
    assert.ok(hover.value.includes("joshka@users.noreply.github.com"));
    assert.ok(hover.value.includes("command:jj.copyChangeId?"));
    assert.ok(hover.value.includes("command:jj.editAnnotatedChange?"));
    assert.deepStrictEqual(hover.isTrusted, {
      enabledCommands: ["jj.copyChangeId", "jj.editAnnotatedChange"],
    });
  });

  test("escapes markdown in commit-provided fields", () => {
    const hover = buildAnnotationHover(change, repositoryRoot);

    assert.ok(!hover.value.includes("[commands](command:evil)"));
  });

  test("uses a placeholder for an empty description", () => {
    const hover = buildAnnotationHover(
      { ...change, description: "" },
      repositoryRoot,
    );
    assert.ok(hover.value.includes("(no description)"));
  });
});
