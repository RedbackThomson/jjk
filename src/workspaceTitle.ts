import * as vscode from "vscode";
import path from "path";
import { resolveRepoPath } from "./jjUtils";
import { logger } from "./logger";
import type { WorkspaceInfo } from "./types";
import { pathEquals } from "./utils";

// Cursor's `${activeRepositoryName}` is always the folder name, so the
// "<main repo> [<workspace>]" label is published as
// `${activeRepositoryBranchName}` through the history provider's current ref.
export function attachWorkspaceTitle(
  sourceControl: vscode.SourceControl,
  repositoryRoot: string,
  workspaces: readonly WorkspaceInfo[],
): vscode.Disposable {
  const workspace = workspaces.find((w) => pathEquals(w.root, repositoryRoot));
  if (!workspace) {
    return new vscode.Disposable(() => {});
  }

  // A secondary workspace's .jj/repo points at <main repo>/.jj/repo.
  const mainRepoName = path.basename(
    path.dirname(path.dirname(resolveRepoPath(repositoryRoot))),
  );
  const onDidChangeCurrentHistoryItemRefs = new vscode.EventEmitter<void>();
  const onDidChangeHistoryItemRefs =
    new vscode.EventEmitter<vscode.SourceControlHistoryItemRefsChangeEvent>();

  try {
    sourceControl.historyProvider = {
      currentHistoryItemRef: {
        id: `workspace/${workspace.name}`,
        name: `${mainRepoName} [${workspace.name}]`,
      },
      currentHistoryItemRemoteRef: undefined,
      currentHistoryItemBaseRef: undefined,
      onDidChangeCurrentHistoryItemRefs:
        onDidChangeCurrentHistoryItemRefs.event,
      onDidChangeHistoryItemRefs: onDidChangeHistoryItemRefs.event,
      provideHistoryItemRefs: () => [],
      provideHistoryItems: () => [],
      provideHistoryItemChanges: () => [],
      resolveHistoryItem: () => undefined,
      resolveHistoryItemChatContext: () => undefined,
      resolveHistoryItemChangeRangeChatContext: () => undefined,
      resolveHistoryItemRefsCommonAncestor: () => undefined,
    };
    // The host only reads currentHistoryItemRef when this event fires.
    onDidChangeCurrentHistoryItemRefs.fire();
  } catch (cause) {
    logger.warn(
      `Workspace window title unavailable; enable the scmHistoryProvider proposed API for jjk.jjk: ${String(cause)}`,
    );
  }

  return vscode.Disposable.from(
    onDidChangeCurrentHistoryItemRefs,
    onDidChangeHistoryItemRefs,
  );
}
