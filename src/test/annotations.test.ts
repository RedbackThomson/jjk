import * as assert from "assert";
import type { Show } from "../types";
import { getExtensionAPI } from "./extensionApi";

suite("annotation hover", () => {
  const repositoryRoot = "/repo/with spaces";
  let buildAnnotationHover: (
    show: Show,
    repositoryRoot: string,
    now?: Date,
  ) => import("vscode").MarkdownString;

  suiteSetup(async () => {
    ({ buildAnnotationHover } = (await getExtensionAPI()).annotations);
  });
  const show: Show = {
    change: {
      changeId: "qtwrprsuulrzpzlttpunwozkyyrokttt",
      commitId: "87668a5047ec4730da305283fb5af9aba0d13aa3",
      shortChangeId: "qtwrprsu",
      shortCommitId: "87668a50",
      uniqueChangeIdPrefix: "qtw",
      uniqueCommitIdPrefix: "87",
      parentChangeIds: ["parentchangeid"],
      parentCommitIds: ["parentcommitid"],
      author: {
        name: "joshka",
        email: "joshka@users.noreply.github.com",
      },
      authoredDate: "2026-08-15 13:07:59",
      description: "Add hover details\n\nDo not run [commands](command:evil).",
      isEmpty: false,
      isConflict: false,
    },
    fileStatuses: [
      { type: "A", file: "new.ts", path: "/repo/new.ts" },
      { type: "M", file: "old.ts", path: "/repo/old.ts" },
    ],
    conflictedFiles: new Set<string>(),
  };

  test("shows commit metadata, file stats, and scoped actions", () => {
    const hover = buildAnnotationHover(
      show,
      repositoryRoot,
      new Date("2026-09-12T13:07:59"),
    );

    assert.ok(hover.value.includes("Add hover details"));
    assert.ok(hover.value.includes("4 weeks ago"));
    assert.ok(hover.value.includes("**qtw**rprsu"));
    assert.ok(hover.value.includes("**87**668a50"));
    assert.ok(hover.value.includes("2 files · 1 added · 1 modified"));
    assert.ok(hover.value.includes("joshka@users.noreply.github.com"));
    assert.ok(hover.value.includes("command:jj.copyChangeId?"));
    assert.ok(hover.value.includes("command:jj.copyCommitId?"));
    assert.ok(hover.value.includes("command:jj.editAnnotatedChange?"));
    assert.deepStrictEqual(hover.isTrusted, {
      enabledCommands: [
        "jj.copyChangeId",
        "jj.copyCommitId",
        "jj.editAnnotatedChange",
      ],
    });
  });

  test("escapes markdown in commit-provided fields", () => {
    const hover = buildAnnotationHover(show, repositoryRoot);

    assert.ok(!hover.value.includes("[commands](command:evil)"));
  });

  test("uses a placeholder for an empty description", () => {
    const hover = buildAnnotationHover(
      { ...show, change: { ...show.change, description: "" } },
      repositoryRoot,
    );
    assert.ok(hover.value.includes("(no description)"));
  });
});
