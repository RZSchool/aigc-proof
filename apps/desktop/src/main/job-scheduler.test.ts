import type {
  HostEnvelope,
  JobResult,
  WorkspaceSummary,
} from "@aigc-proof/host-contracts";
import { describe, expect, it, vi } from "vitest";

import type { UtilityJob } from "../shared/utility-protocol";
import { JobScheduler, type UtilityExecutor } from "./job-scheduler";

const workspaceSummary: WorkspaceSummary = {
  reference: {
    id: `ref_${"w".repeat(32)}`,
    kind: "workspace",
    displayLabel: "workspace",
    displayPath: "C:\\workspace",
  },
  displayPath: "C:\\workspace",
  workspace: {
    workspace_version: "0.2.0",
    created_at: "2026-07-13T00:00:00Z",
    project: {},
    assets: [],
  },
};

const utilityJob = {
  operation: "loadWorkspace" as const,
  payload: { path: "C:\\workspace" },
};

const published = (): Promise<JobResult> =>
  Promise.resolve({ operation: "loadWorkspace", data: workspaceSummary });

class ControlledExecutor implements UtilityExecutor {
  readonly calls: string[] = [];
  readonly pending: Array<(value: HostEnvelope<unknown>) => void> = [];
  readonly shutdown = vi.fn(async () => undefined);

  execute(
    jobId: string,
    _job: UtilityJob,
    onProgress: (
      sequence: number,
      completedUnits: number,
      message: string,
    ) => void,
  ): Promise<HostEnvelope<unknown>> {
    void _job;
    this.calls.push(jobId);
    onProgress(1, 35, "accepted");
    return new Promise((resolve) => this.pending.push(resolve));
  }
}

async function nextTurn(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("bounded job scheduler", () => {
  it("publishes monotonic progress and a referenced strict result", async () => {
    const executor = new ControlledExecutor();
    const scheduler = new JobScheduler(executor);
    const events: number[] = [];
    scheduler.subscribe((event) =>
      events.push(event.job.progress.completedUnits),
    );
    const started = scheduler.enqueue(
      7,
      "loadWorkspace",
      utilityJob,
      published,
    );
    expect(started.ok).toBe(true);
    await nextTurn();
    executor.pending[0]!({ ok: true, data: { native: true } });
    const result = await scheduler.wait(
      7,
      started.ok ? started.data.reference : {},
    );
    expect(result.ok && result.data.operation).toBe("loadWorkspace");
    expect(
      events.every(
        (value, index) => index === 0 || events[index - 1]! <= value,
      ),
    ).toBe(true);
    const jobs = scheduler.list(7);
    expect(jobs.ok && jobs.data[0]?.state).toBe("succeeded");
    expect(jobs.ok && jobs.data[0]?.progress.completedUnits).toBe(100);
  });

  it("cancels queued work without dispatch and treats running cancellation as a request", async () => {
    const executor = new ControlledExecutor();
    const scheduler = new JobScheduler(executor);
    const first = scheduler.enqueue(7, "loadWorkspace", utilityJob, published);
    await nextTurn();
    const second = scheduler.enqueue(7, "loadWorkspace", utilityJob, published);
    expect(first.ok && second.ok).toBe(true);
    const cancelled = scheduler.cancel(
      7,
      second.ok ? second.data.reference : {},
    );
    expect(cancelled.ok && cancelled.data.state).toBe("cancelled");
    const requested = scheduler.cancel(7, first.ok ? first.data.reference : {});
    expect(requested.ok && requested.data.state).toBe("cancel_requested");
    expect(requested.ok && requested.data.progress.message).toContain(
      "原子阶段不可中断",
    );
    executor.pending[0]!({ ok: true, data: {} });
    await scheduler.wait(7, first.ok ? first.data.reference : {});
    expect(executor.calls).toHaveLength(1);
  });

  it("enforces sixteen queued jobs and never replays a Utility-loss failure", async () => {
    const executor = new ControlledExecutor();
    const scheduler = new JobScheduler(executor);
    const first = scheduler.enqueue(7, "loadWorkspace", utilityJob, published);
    await nextTurn();
    const queued = Array.from({ length: 16 }, () =>
      scheduler.enqueue(7, "loadWorkspace", utilityJob, published),
    );
    expect(queued.every((value) => value.ok)).toBe(true);
    const overflow = scheduler.enqueue(
      7,
      "loadWorkspace",
      utilityJob,
      published,
    );
    expect(!overflow.ok && overflow.error.code).toBe("JOB_QUEUE_FULL");

    executor.pending[0]!({
      ok: false,
      error: {
        code: "UTILITY_PROCESS_LOST",
        kind: "utility",
        message: "lost; not replayed",
      },
    });
    const failed = await scheduler.wait(
      7,
      first.ok ? first.data.reference : {},
    );
    expect(!failed.ok && failed.error.code).toBe("UTILITY_PROCESS_LOST");
    await nextTurn();
    expect(executor.calls).toHaveLength(2);
    expect(new Set(executor.calls).size).toBe(2);
  });
});
