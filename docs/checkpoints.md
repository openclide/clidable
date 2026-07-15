# Checkpoints

Checkpoints are Clidable's safety net: **before every message you send, your entire project is snapshotted.** If an agent wrecks something three prompts ago, you roll back in two clicks — no `git stash` archaeology, no lost work.

## How to use them

### Creating

You don't. Press Enter in the composer and a checkpoint is taken automatically just before your message reaches the agent. You'll see the rewind button pulse **"Checkpointed"**; if the snapshot failed, a small error chip appears instead (your message still sends).

If nothing changed since the last checkpoint, Clidable records a lightweight "no-op" marker instead of an identical snapshot — so the timeline still mirrors your conversation one-to-one.

### Restoring

1. Click the **rewind icon** in the composer footer.
2. Pick a checkpoint — each row shows when, which agent, your message at the time, and (in the desktop app) a thumbnail of the preview pane at that moment. Click a thumbnail for a full-screen view.
3. Click **Restore** and confirm.

Your working tree — every file in the project — reverts to exactly that moment. Open editors, the file tree, and the changes list refresh automatically.

Scope toggle: **This terminal** shows only checkpoints triggered from the current session; **All** shows every checkpoint in the project, across all agents and terminals.

### Comparing (without restoring)

Every checkpoint row also has **Compare**: it pivots the Code pane to the **Changes** view with that checkpoint as the diff base. You see precisely what changed since that message — per file, as unified diffs. The **"Since:"** picker in the Changes view does the same thing: compare against HEAD (your real git) or any checkpoint.

This is the answer to "what did the agent actually do just now?" — compare against your last message's checkpoint.

## How it works (and why it's safe)

- Each project gets a **shadow git repository** stored in Clidable's data directory — *not* in your project. Your own `.git`, branches, and history are never touched, and the shadow repo never shows up in `git status`.
- A checkpoint is a commit of your full working tree into that shadow repo. Restore is a hard reset of the working tree to that commit.
- Snapshots **respect your `.gitignore`** and always exclude heavy build artifacts (`node_modules`, `.next`, `dist`, `build`, `target`, `.cache`, `.DS_Store`, and friends) — so they're fast and small even on big projects.
- Project identity is a UUID stored at `<project>/.clidable/project-id` (with its own `.gitignore` so it stays out of your repo). Because identity isn't tied to the folder path, **renaming or moving a project keeps its entire checkpoint history**.
- Checkpoint metadata (time, agent, terminal, your message, screenshot) lives in Clidable's SQLite database; concurrent sends are serialized per project, so parallel agents can't corrupt a snapshot.

Storage locations (see [Configuration](./configuration.md#data-cache-and-log-locations) for your OS):

```
<data>/clidable.db                          # metadata
<data>/projects/<uuid>/checkpoints.git      # the shadow repo
<data>/projects/<uuid>/screenshots/         # preview thumbnails (desktop app)
```

## Good to know

- **Restore affects files, not the conversation.** The agent's terminal scrollback isn't rewound — tell the agent what you did ("I restored the project to before my last message") so its mental model matches the disk.
- **Your real git is untouched by restore.** If you'd committed to your own repo after the checkpoint, restoring rewinds the *files*; your git history still has the commits. Check `git status` after restoring if you mix the two.
- **Restoring doesn't delete newer checkpoints** — you can rewind, look around, and the timeline moves forward from wherever you are.
- **Untracked files are included** in snapshots (everything not ignored), so brand-new files the agent created are captured and restorable too.
- **Screenshots need the desktop app.** Thumbnails are captured from the preview pane via the native shell (permission-free — it snapshots the app's own webview, not your screen). In a browser, checkpoints work identically but without thumbnails.
- **Typing directly in the terminal doesn't checkpoint** (yet) — only composer sends do. If you're about to let an agent do something risky from a direct terminal command, send any message through the composer first to drop a checkpoint.
- **Retention is currently unlimited.** Old checkpoints aren't pruned yet. If a long-lived project's shadow repo grows large, you can delete `<data>/projects/<uuid>/checkpoints.git` to start fresh (you lose that project's rewind history; the project itself is untouched).
