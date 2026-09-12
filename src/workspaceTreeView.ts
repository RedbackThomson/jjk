import * as vscode from "vscode";
import path from "path";
import type { RepoHandle } from "./repoHandle";
import type { WorkspaceInfo } from "./types";
import { pathEquals } from "./utils";

interface WorkspaceManagerDeps {
  readonly initialRepo: RepoHandle;
  readonly loadWorkspaces: (
    repo: RepoHandle,
  ) => Promise<readonly WorkspaceInfo[]>;
}

export class WorkspaceManager implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    WorkspaceTreeItem | undefined | void
  >();
  private readonly treeView: vscode.TreeView<WorkspaceTreeItem>;
  private readonly statusBarItem: vscode.StatusBarItem;
  private selectedRepo: RepoHandle;
  private repoUpdateSubscription: vscode.Disposable | undefined;
  private items: WorkspaceTreeItem[] = [];

  constructor(private readonly deps: WorkspaceManagerDeps) {
    this.selectedRepo = deps.initialRepo;
    this.treeView = vscode.window.createTreeView("jjWorkspaces", {
      treeDataProvider: {
        onDidChangeTreeData: this.onDidChangeTreeDataEmitter.event,
        getTreeItem: (item) => item,
        getChildren: () => this.items,
      },
    });
    this.statusBarItem = vscode.window.createStatusBarItem(
      "jjk.workspace",
      vscode.StatusBarAlignment.Left,
      101,
    );
    this.statusBarItem.name = "Jujutsu Workspace";
    this.subscriptions.push(
      this.treeView,
      this.statusBarItem,
      this.onDidChangeTreeDataEmitter,
    );
    this.updateTitle();
    this.subscribeToRepoUpdates();
  }

  getSelectedRepo(): RepoHandle {
    return this.selectedRepo;
  }

  async setSelectedRepo(repo: RepoHandle): Promise<void> {
    if (
      repo.config.repositoryRoot === this.selectedRepo.config.repositoryRoot
    ) {
      return;
    }
    this.repoUpdateSubscription?.dispose();
    this.selectedRepo = repo;
    this.updateTitle();
    this.subscribeToRepoUpdates();
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const repo = this.selectedRepo;
    let workspaces: readonly WorkspaceInfo[];
    try {
      workspaces = await this.deps.loadWorkspaces(repo);
    } catch (cause) {
      if (repo === this.selectedRepo) {
        this.showLoadFailure(cause);
      }
      return;
    }
    if (repo !== this.selectedRepo) {
      return;
    }

    this.treeView.message = undefined;
    this.items = workspaces.map(
      (workspace) =>
        new WorkspaceTreeItem(
          workspace,
          pathEquals(workspace.root, repo.config.repositoryRoot),
        ),
    );
    const current = this.items.find((item) => item.isCurrent)?.workspace;
    const repositoryName = path.basename(
      workspaces.find((workspace) => workspace.name === "default")?.root ||
        workspaces.find((workspace) => workspace.root)?.root ||
        repo.config.repositoryRoot,
    );
    this.treeView.title = `Workspaces (${repositoryName})`;
    this.statusBarItem.text = `$(repo) ${repositoryName}${current ? ` (${current.name})` : ""}`;
    this.statusBarItem.tooltip = "Switch Jujutsu workspace";
    this.statusBarItem.command = {
      command: "jj.selectWorkspace",
      title: "Switch Jujutsu workspace",
      arguments: [repo.config.repositoryRoot],
    };
    this.statusBarItem.show();
    this.onDidChangeTreeDataEmitter.fire();
  }

  dispose(): void {
    this.repoUpdateSubscription?.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private showLoadFailure(cause: unknown): void {
    this.items = [];
    this.treeView.message = `Failed to load workspaces: ${
      cause instanceof Error ? cause.message : String(cause)
    }`;
    this.statusBarItem.hide();
    this.onDidChangeTreeDataEmitter.fire();
  }

  private updateTitle(): void {
    this.treeView.title = `Workspaces (${path.basename(
      this.selectedRepo.config.repositoryRoot,
    )})`;
  }

  private subscribeToRepoUpdates(): void {
    this.repoUpdateSubscription = this.selectedRepo.onDidUpdateEmitter.event(
      () => void this.refresh(),
    );
  }
}

export class WorkspaceTreeItem extends vscode.TreeItem {
  constructor(
    readonly workspace: WorkspaceInfo,
    readonly isCurrent: boolean,
  ) {
    super(workspace.name, vscode.TreeItemCollapsibleState.None);
    const isMissing = !workspace.rootExists;
    this.id = workspace.name;
    this.iconPath = new vscode.ThemeIcon(
      isMissing ? "warning" : isCurrent ? "check" : "folder",
    );
    this.description = [
      workspace.shortChangeId,
      workspace.shortCommitId,
      ...workspace.bookmarks,
      ...(isMissing ? ["missing"] : []),
    ].join(" · ");
    this.contextValue = isMissing
      ? "jjMissingWorkspace"
      : isCurrent
        ? "jjCurrentWorkspace"
        : "jjWorkspace";
    if (!isCurrent && !isMissing) {
      this.command = {
        command: "jj.openWorkspace",
        title: "Open Workspace",
        arguments: [workspace.root],
      };
    }

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(
      `**${isCurrent ? "Current workspace" : "Workspace"}:** `,
    );
    tooltip.appendText(workspace.name);
    tooltip.appendMarkdown("  \n**Change:** ");
    tooltip.appendText(workspace.changeId);
    tooltip.appendMarkdown("  \n**Commit:** ");
    tooltip.appendText(workspace.commitId);
    if (workspace.bookmarks.length > 0) {
      tooltip.appendMarkdown("  \n**Bookmarks:** ");
      tooltip.appendText(workspace.bookmarks.join(", "));
    }
    tooltip.appendMarkdown("  \n**Author:** ");
    tooltip.appendText(
      workspace.author.name || workspace.author.email || "Unknown author",
    );
    tooltip.appendMarkdown("  \n**Date:** ");
    tooltip.appendText(workspace.authoredDate);
    if (workspace.description) {
      tooltip.appendMarkdown("\n\n");
      tooltip.appendText(workspace.description);
    }
    tooltip.appendMarkdown("\n\n");
    tooltip.appendText(
      workspace.root || "Workspace root could not be resolved",
    );
    if (isMissing) {
      tooltip.appendMarkdown(
        "\n\n$(warning) This workspace root no longer exists. Run `jj workspace forget` to remove it.",
      );
      tooltip.supportThemeIcons = true;
    }
    this.tooltip = tooltip;
  }
}
