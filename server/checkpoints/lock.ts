/**
 * Per-project mutex for serializing checkpoint creates.
 *
 * Two composer Sends firing within the same millisecond (different
 * agents, same project — a split-terminal scenario) would otherwise
 * race the shadow git's index. Serializing keeps `git add -A` →
 * `git commit` atomic from this process's perspective.
 *
 * Implementation: a FIFO promise chain per project UUID. Each caller
 * appends its own release signal to the chain and waits for the
 * previous tail. The lock holder runs `fn`, then resolves its signal,
 * unblocking whoever came after. The map self-cleans when no one is
 * queued (otherwise it would grow by one entry per project ever
 * touched in a session).
 */
const locks = new Map<string, Promise<void>>();

export async function withProjectLock<T>(
  projectUuid: string,
  fn: () => Promise<T>,
): Promise<T> {
  // The current tail is whoever holds (or is about to hold) the lock.
  // We attach our wait to it. `.catch(() => {})` keeps a thrown lock
  // holder from aborting our chain — the *next* holder shouldn't
  // inherit an error.
  const previousTail = (locks.get(projectUuid) ?? Promise.resolve()).catch(
    () => {},
  );

  let release!: () => void;
  const ourSignal = new Promise<void>((r) => {
    release = r;
  });
  locks.set(projectUuid, ourSignal);

  await previousTail;
  try {
    return await fn();
  } finally {
    release();
    // If no one queued behind us, drop the entry so the map doesn't
    // grow forever. The strict-equality check avoids racing a new
    // queuer that just attached.
    if (locks.get(projectUuid) === ourSignal) locks.delete(projectUuid);
  }
}
