import * as vscode from "vscode";
import { Effect, Ref, Scope } from "effect";
import type { JJCli } from "./services/JJCli";
import type { ExtensionResources } from "./services/ExtensionResources";
import type { Vscode } from "./services/Vscode";
import { getActiveTextEditor, getConfigurationValue } from "./services/Vscode";
import {
  annotate,
  getOriginalPath,
  getShow,
  jjEdit,
} from "./services/Repository";
import type { RepoHandle } from "./repoHandle";
import { getParams } from "./uri";
import type { Show } from "./types";
import type { RepoCommandEffect } from "./commandHandlerShared";
import { formatChangeStats, getChangeStats } from "./changeStats";

import type { JjWatchmanRegisterSnapshotTriggerRef } from "./services/JjWatchmanSnapshotTriggerRef";

type RepoEffectEnv =
  | JJCli
  | Vscode
  | ExtensionResources
  | JjWatchmanRegisterSnapshotTriggerRef;

interface AnnotationState {
  readonly annotateInfo: AnnotationInfo | undefined;
  readonly activeEditorUri: vscode.Uri | undefined;
  readonly activeLines: readonly number[];
}

interface AnnotationInfo {
  readonly uri: vscode.Uri;
  readonly changeIdsByLine: readonly string[];
}

const COPY_CHANGE_ID_COMMAND = "jj.copyChangeId";
const COPY_COMMIT_ID_COMMAND = "jj.copyCommitId";
const EDIT_ANNOTATED_CHANGE_COMMAND = "jj.editAnnotatedChange";
const VIEW_CHANGE_COMMAND = "jj.viewChange";
const OPEN_CHANGE_FILE_DIFF_COMMAND = "jj.openChangeFileDiff";

interface AnnotationHoverContext {
  readonly filePath: string;
  readonly line: number;
}

function appendSegmentedId(
  hover: vscode.MarkdownString,
  label: string,
  displayId: string,
  uniquePrefix: string,
) {
  const prefixLength = displayId.startsWith(uniquePrefix)
    ? uniquePrefix.length
    : displayId.length;
  hover.appendMarkdown(`**${label}:** **`);
  hover.appendText(displayId.slice(0, prefixLength));
  hover.appendMarkdown("**");
  hover.appendText(displayId.slice(prefixLength));
}

export function buildAnnotationHover(
  show: Show,
  repositoryRoot: string,
  context?: AnnotationHoverContext,
): vscode.MarkdownString {
  const change = show.change;
  const hover = new vscode.MarkdownString();
  hover.isTrusted = {
    enabledCommands: [
      COPY_CHANGE_ID_COMMAND,
      COPY_COMMIT_ID_COMMAND,
      EDIT_ANNOTATED_CHANGE_COMMAND,
      VIEW_CHANGE_COMMAND,
      OPEN_CHANGE_FILE_DIFF_COMMAND,
    ],
  };
  hover.supportThemeIcons = true;

  hover.appendMarkdown("$(account) **");
  hover.appendText(
    change.author.name || change.author.email || "Unknown author",
  );
  hover.appendMarkdown("**");
  if (change.relativeAuthoredDate) {
    hover.appendMarkdown(" · ");
    hover.appendText(change.relativeAuthoredDate);
  }
  hover.appendMarkdown("  \n");
  if (change.author.email && change.author.email !== change.author.name) {
    hover.appendText(change.author.email);
    hover.appendMarkdown(" · ");
  }
  hover.appendMarkdown("_");
  hover.appendText(change.authoredDate);
  hover.appendMarkdown("_\n\n---\n\n");

  const description = change.description || "(no description)";
  const [subject, ...bodyLines] = description.split("\n");
  hover.appendMarkdown("### ");
  hover.appendText(subject);
  const body = bodyLines.join("\n").trim();
  if (body) {
    hover.appendMarkdown("\n\n");
    hover.appendText(body);
  }
  hover.appendMarkdown("\n\n");

  hover.appendMarkdown("$(git-commit) ");
  appendSegmentedId(
    hover,
    "Change",
    change.shortChangeId,
    change.uniqueChangeIdPrefix,
  );
  hover.appendMarkdown("  \n$(circle-filled) ");
  appendSegmentedId(
    hover,
    "Commit",
    change.shortCommitId,
    change.uniqueCommitIdPrefix,
  );
  if (change.parentChangeIds.length > 0) {
    hover.appendMarkdown(
      `  \n$(git-merge) ${change.parentChangeIds.length} parent${change.parentChangeIds.length === 1 ? "" : "s"}`,
    );
  }
  hover.appendMarkdown("  \n$(files) ");
  hover.appendText(formatChangeStats(getChangeStats(show.fileStatuses)));
  hover.appendMarkdown("\n\n---\n\n");

  const copyChangeCommandArgs = encodeURIComponent(
    JSON.stringify([change.shortChangeId]),
  );
  const copyCommitCommandArgs = encodeURIComponent(
    JSON.stringify([change.shortCommitId]),
  );
  const editCommandArgs = encodeURIComponent(
    JSON.stringify([repositoryRoot, change.changeId]),
  );
  const viewChangeCommandArgs = encodeURIComponent(
    JSON.stringify([repositoryRoot, change.changeId]),
  );
  hover.appendMarkdown(
    `[$(copy) Copy Change](command:${COPY_CHANGE_ID_COMMAND}?${copyChangeCommandArgs}) · ` +
      `[$(copy) Copy Commit](command:${COPY_COMMIT_ID_COMMAND}?${copyCommitCommandArgs}) · ` +
      `[$(edit) Edit Change](command:${EDIT_ANNOTATED_CHANGE_COMMAND}?${editCommandArgs})`,
  );
  hover.appendMarkdown(
    `  \n[$(files) View Change](command:${VIEW_CHANGE_COMMAND}?${viewChangeCommandArgs})`,
  );
  if (context) {
    const openChangesCommandArgs = encodeURIComponent(
      JSON.stringify([change.changeId, context.filePath, context.line]),
    );
    hover.appendMarkdown(
      ` · [$(compare-changes) Open Changes](command:${OPEN_CHANGE_FILE_DIFF_COMMAND}?${openChangesCommandArgs})`,
    );
  }
  return hover;
}

export interface AnnotationDeps {
  readonly registerScoped: <A extends { dispose(): unknown }>(
    acquire: () => A,
  ) => Promise<A>;
  readonly runInExtensionScope: <A, E>(
    effect: Effect.Effect<A, E, Vscode | Scope.Scope>,
  ) => Promise<A>;
  readonly dispatchExtensionEffect: (
    effect: Effect.Effect<unknown, Error, Vscode>,
    errorLabel: string,
  ) => void;
  readonly findRepoByUri: (uri: vscode.Uri) => RepoHandle | undefined;
  readonly runRepoEffect: <A, E>(
    repo: RepoHandle,
    effect: Effect.Effect<A, E, RepoEffectEnv>,
  ) => Effect.Effect<A, Error>;
  readonly runRepoCommand: (
    repo: RepoHandle,
    effect: RepoCommandEffect,
    errorLabel: string,
  ) => Promise<void>;
  readonly retryImmutable: <A>(
    effect: RepoCommandEffect<A>,
    confirmPrompt: string,
    retryEffect: RepoCommandEffect<A>,
  ) => RepoCommandEffect<A | undefined>;
}

export async function setupAnnotations(deps: AnnotationDeps): Promise<void> {
  await deps.registerScoped(() =>
    vscode.commands.registerCommand(
      COPY_CHANGE_ID_COMMAND,
      async (changeId: unknown) => {
        if (typeof changeId !== "string" || changeId.length === 0) {
          return;
        }
        await vscode.env.clipboard.writeText(changeId);
        vscode.window.setStatusBarMessage(
          `Copied Jujutsu change ID ${changeId}`,
          2_000,
        );
      },
    ),
  );
  await deps.registerScoped(() =>
    vscode.commands.registerCommand(
      COPY_COMMIT_ID_COMMAND,
      async (commitId: unknown) => {
        if (typeof commitId !== "string" || commitId.length === 0) {
          return;
        }
        await vscode.env.clipboard.writeText(commitId);
        vscode.window.setStatusBarMessage(
          `Copied Git commit ID ${commitId}`,
          2_000,
        );
      },
    ),
  );
  await deps.registerScoped(() =>
    vscode.commands.registerCommand(
      EDIT_ANNOTATED_CHANGE_COMMAND,
      async (repositoryRoot: unknown, changeId: unknown) => {
        if (
          typeof repositoryRoot !== "string" ||
          typeof changeId !== "string" ||
          changeId.length === 0
        ) {
          return;
        }
        const repo = deps.findRepoByUri(vscode.Uri.file(repositoryRoot));
        if (!repo) {
          void vscode.window.showErrorMessage(
            "Could not find the Jujutsu repository for this annotation.",
          );
          return;
        }
        await deps.runRepoCommand(
          repo,
          deps.retryImmutable(
            jjEdit(repo.config, changeId),
            "The change is immutable. Edit anyway?",
            jjEdit(repo.config, changeId, true),
          ),
          "Failed to edit annotated change",
        );
      },
    ),
  );
  const annotationDecoration = await deps.registerScoped(() =>
    vscode.window.createTextEditorDecorationType({
      after: {
        margin: "0 0 0 3em",
        textDecoration: "none",
      },
      rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
    }),
  );
  const annotationState = await deps.runInExtensionScope(
    Ref.make<AnnotationState>({
      annotateInfo: undefined,
      activeEditorUri: undefined,
      activeLines: [],
    }),
  );

  const uriEquals = (
    left: vscode.Uri | undefined,
    right: vscode.Uri | undefined,
  ) => left?.toString() === right?.toString();
  const sameLines = (left: readonly number[], right: readonly number[]) =>
    left.length === right.length &&
    left.every((line, index) => line === right[index]);
  const getAnnotationRev = (uri: vscode.Uri): string => {
    if (uri.scheme !== "jj") {
      return "@";
    }
    const params = getParams(uri);
    return "diffOriginalRev" in params
      ? `${params.diffOriginalRev}-`
      : params.rev;
  };
  const clearAnnotations = (editor: vscode.TextEditor) =>
    Effect.sync(() => {
      editor.setDecorations(annotationDecoration, []);
    });
  const getAnnotationsEnabled = (repo: RepoHandle) =>
    getConfigurationValue<boolean>(
      "jjk",
      "enableAnnotations",
      vscode.Uri.file(repo.config.repositoryRoot),
    );
  const getAnnotationHoverEnabled = (repo: RepoHandle) =>
    getConfigurationValue<boolean>(
      "jjk",
      "enableAnnotationHover",
      vscode.Uri.file(repo.config.repositoryRoot),
    );

  const updateAnnotateInfoEffect = (
    uri: vscode.Uri,
  ): Effect.Effect<void, Error, Vscode> =>
    Effect.gen(function* () {
      if (!["file", "jj"].includes(uri.scheme)) {
        yield* Ref.update(annotationState, (state) => ({
          ...state,
          annotateInfo: undefined,
        }));
        return;
      }

      const repo = deps.findRepoByUri(uri);
      if (!repo) {
        yield* Ref.update(annotationState, (state) => ({
          ...state,
          annotateInfo: undefined,
        }));
        return;
      }

      const annotationsEnabled = yield* getAnnotationsEnabled(repo);
      if (!annotationsEnabled) {
        yield* Ref.update(annotationState, (state) => ({
          ...state,
          annotateInfo: undefined,
        }));
        return;
      }

      const rev = getAnnotationRev(uri);
      const params = uri.scheme === "jj" ? getParams(uri) : undefined;
      const annotateEffect =
        params && "diffOriginalRev" in params
          ? getOriginalPath(
              repo.config,
              params.diffOriginalRev,
              uri.fsPath,
            ).pipe(
              Effect.flatMap((originalPath) =>
                annotate(repo.config, originalPath, rev),
              ),
            )
          : annotate(repo.config, uri.fsPath, rev);
      const changeIdsByLine = yield* deps
        .runRepoEffect(repo, annotateEffect)
        .pipe(
          Effect.catchIf(
            (error) => error.message.includes("more than one revision"),
            () => Effect.succeed<string[]>([]),
          ),
        );

      yield* Ref.update(annotationState, (state) => ({
        ...state,
        annotateInfo:
          uriEquals(state.activeEditorUri, uri) && changeIdsByLine.length > 0
            ? { uri, changeIdsByLine }
            : undefined,
      }));
    });

  const setDecorationsEffect = (
    editor: vscode.TextEditor,
    lines: readonly number[],
  ): Effect.Effect<void, Error, Vscode> =>
    Effect.gen(function* () {
      const repo = deps.findRepoByUri(editor.document.uri);
      if (!repo) {
        return;
      }

      const annotationsEnabled = yield* getAnnotationsEnabled(repo);
      if (!annotationsEnabled) {
        yield* clearAnnotations(editor);
        return;
      }
      const annotationHoverEnabled = yield* getAnnotationHoverEnabled(repo);

      const state = yield* Ref.get(annotationState);
      if (
        !state.annotateInfo ||
        !uriEquals(state.annotateInfo.uri, editor.document.uri) ||
        !uriEquals(state.activeEditorUri, editor.document.uri) ||
        !sameLines(state.activeLines, lines)
      ) {
        return;
      }

      const annotateInfo = state.annotateInfo;
      const safeLines = lines.filter(
        (line) => line !== annotateInfo.changeIdsByLine.length,
      );
      const uniqueChangeIds = [
        ...new Set(
          safeLines
            .map((line) => annotateInfo.changeIdsByLine[line])
            .filter((changeId): changeId is string => Boolean(changeId)),
        ),
      ];
      const changes = new Map(
        yield* Effect.forEach(
          uniqueChangeIds,
          (changeId) =>
            deps
              .runRepoEffect(repo, getShow(repo.config, changeId))
              .pipe(
                Effect.map((showResult) => [changeId, showResult] as const),
              ),
          { concurrency: "unbounded" },
        ),
      );

      const nextState = yield* Ref.get(annotationState);
      if (
        !nextState.annotateInfo ||
        !uriEquals(nextState.annotateInfo.uri, editor.document.uri) ||
        !uriEquals(nextState.activeEditorUri, editor.document.uri) ||
        !sameLines(nextState.activeLines, lines)
      ) {
        return;
      }

      const decorations: vscode.DecorationOptions[] = [];
      for (const line of safeLines) {
        const changeId = nextState.annotateInfo.changeIdsByLine[line];
        if (!changeId) {
          continue;
        }

        const show = changes.get(changeId);
        if (!show) {
          continue;
        }
        const change = show.change;

        decorations.push({
          hoverMessage: annotationHoverEnabled
            ? buildAnnotationHover(show, repo.config.repositoryRoot, {
                filePath: editor.document.uri.fsPath,
                line,
              })
            : undefined,
          renderOptions: {
            after: {
              backgroundColor: "#00000000",
              color: "#99999959",
              contentText: ` ${change.author.name} at ${change.authoredDate} • ${change.description || "(no description)"} • ${change.shortChangeId} `,
              textDecoration: "none;",
            },
          },
          range: editor.document.validateRange(
            new vscode.Range(line, 2 ** 30 - 1, line, 2 ** 30 - 1),
          ),
        });
      }

      yield* Effect.sync(() => {
        editor.setDecorations(annotationDecoration, decorations);
      });
    });

  const handleDidChangeActiveTextEditorEffect = (
    editor: vscode.TextEditor | undefined,
  ): Effect.Effect<void, Error, Vscode> =>
    Effect.gen(function* () {
      if (!editor) {
        yield* Ref.update(annotationState, (state) => ({
          ...state,
          activeEditorUri: undefined,
          annotateInfo: undefined,
          activeLines: [],
        }));
        return;
      }

      const activeLines = editor.selections.map(
        (selection) => selection.active.line,
      );
      yield* Ref.update(annotationState, (state) => ({
        ...state,
        activeEditorUri: editor.document.uri,
        activeLines,
      }));
      yield* updateAnnotateInfoEffect(editor.document.uri);
      yield* setDecorationsEffect(editor, activeLines);
    });

  await deps.registerScoped(() =>
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      deps.dispatchExtensionEffect(
        handleDidChangeActiveTextEditorEffect(editor),
        "Failed to update annotations for active editor",
      );
    }),
  );
  await deps.registerScoped(() =>
    vscode.window.onDidChangeTextEditorSelection((event) => {
      deps.dispatchExtensionEffect(
        Effect.gen(function* () {
          const activeLines = event.selections.map(
            (selection) => selection.active.line,
          );
          yield* Ref.update(annotationState, (state) => ({
            ...state,
            activeLines,
          }));
          yield* setDecorationsEffect(event.textEditor, activeLines);
        }),
        "Failed to update annotations for text selection",
      );
    }),
  );
  await deps.registerScoped(() =>
    vscode.workspace.onDidChangeTextDocument((event) => {
      deps.dispatchExtensionEffect(
        Effect.gen(function* () {
          const editor = yield* getActiveTextEditor();
          if (
            !editor ||
            editor.document.uri.toString() !== event.document.uri.toString()
          ) {
            return;
          }

          const state = yield* Ref.get(annotationState);
          yield* setDecorationsEffect(editor, state.activeLines);
        }),
        "Failed to refresh annotations after document change",
      );
    }),
  );
  await deps.registerScoped(() =>
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        !event.affectsConfiguration("jjk.enableAnnotations") &&
        !event.affectsConfiguration("jjk.enableAnnotationHover")
      ) {
        return;
      }
      deps.dispatchExtensionEffect(
        getActiveTextEditor().pipe(
          Effect.flatMap((editor) =>
            editor
              ? handleDidChangeActiveTextEditorEffect(editor)
              : Effect.void,
          ),
        ),
        "Failed to update annotations after configuration change",
      );
    }),
  );
  deps.dispatchExtensionEffect(
    getActiveTextEditor().pipe(
      Effect.flatMap((currentEditor) =>
        currentEditor
          ? handleDidChangeActiveTextEditorEffect(currentEditor)
          : Effect.void,
      ),
    ),
    "Failed to initialize annotations",
  );
}
