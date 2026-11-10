/** Keep parallel early-phase modules ahead of later-phase reading. */
export function nextReadingTopic<T extends { id: string; phaseId: string }>(
  topics: readonly T[],
  phases: readonly { id: string }[],
  progress: readonly { topicId: string; status: string }[],
): T | null {
  const phaseOrder = new Map(phases.map((p, i) => [p.id, i]));
  const status = new Map(progress.map((p) => [p.topicId, p.status]));
  return (
    [...topics]
      .sort(
        (a, b) =>
          (phaseOrder.get(a.phaseId) ?? phases.length) -
          (phaseOrder.get(b.phaseId) ?? phases.length),
      )
      .find((t) => status.get(t.id) !== "read") ?? null
  );
}
