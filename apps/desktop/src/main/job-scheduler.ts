import { randomUUID } from "node:crypto";

import {
  RUNTIME_LIMITS,
  taskReferenceSchema,
  resultReferenceSchema,
  type HostEnvelope,
  type HostError,
  type HostReference,
  type JobEvent,
  type JobOperation,
  type JobProgress,
  type JobResult,
  type JobSnapshot,
  type ResultReference,
  type TaskReference,
} from "@aigc-proof/host-contracts";
import type { UtilityJob } from "../shared/utility-protocol";

export interface UtilityExecutor {
  execute(
    jobId: string,
    job: UtilityJob,
    onProgress: (
      sequence: number,
      completedUnits: number,
      message: string,
    ) => void,
  ): Promise<HostEnvelope<unknown>>;
  shutdown(): Promise<void>;
}

type PublishResult = (nativeData: unknown) => Promise<JobResult>;

interface JobRecord {
  owner: number;
  reference: TaskReference;
  operation: JobOperation;
  utilityJob: UtilityJob;
  publish: PublishResult;
  state: JobSnapshot["state"];
  progress: JobProgress;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  cancelRequestedAt?: string;
  resultReference?: ResultReference;
  result?: JobResult;
  error?: HostError;
  complete: (snapshot: JobSnapshot) => void;
  completion: Promise<JobSnapshot>;
  lastUtilityProgressSequence: number;
}

const transitions: Record<JobSnapshot["state"], JobSnapshot["state"][]> = {
  queued: ["running", "cancelled"],
  running: ["cancel_requested", "succeeded", "failed"],
  cancel_requested: ["cancelled", "succeeded", "failed"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

function now(): string {
  return new Date().toISOString();
}

function failure(
  code: string,
  message: string,
  kind = "job",
): HostEnvelope<never> {
  return { ok: false, error: { code, kind, message } };
}

function makeReference<K extends "task" | "result">(
  kind: K,
  label: string,
): HostReference<K> {
  return Object.freeze({
    id: `ref_${randomUUID().replaceAll("-", "")}`,
    kind,
    displayLabel: label,
  }) as HostReference<K>;
}

export class JobScheduler {
  readonly #jobs = new Map<string, JobRecord>();
  readonly #results = new Map<string, JobRecord>();
  readonly #queue: JobRecord[] = [];
  readonly #listeners = new Set<(event: JobEvent, owner: number) => void>();
  #running: JobRecord | undefined;
  #eventSequence = 0;

  constructor(private readonly utility: UtilityExecutor) {}

  enqueue(
    owner: number,
    operation: JobOperation,
    utilityJob: UtilityJob,
    publish: PublishResult,
  ): HostEnvelope<JobSnapshot> {
    if (this.#queue.length >= RUNTIME_LIMITS.maxQueuedJobs) {
      return failure(
        "JOB_QUEUE_FULL",
        "任务队列已满，请等待已有任务完成。",
        "capacity",
      );
    }
    let complete!: (snapshot: JobSnapshot) => void;
    const completion = new Promise<JobSnapshot>((resolve) => {
      complete = resolve;
    });
    const createdAt = now();
    const record: JobRecord = {
      owner,
      reference: makeReference("task", `${operation} 任务`) as TaskReference,
      operation,
      utilityJob,
      publish,
      state: "queued",
      progress: {
        sequence: 1,
        phase: "queued",
        completedUnits: 10,
        totalUnits: 100,
        message: "授权已确认，任务正在有界队列中等待。",
        interruptibility: "queued-cancellable",
        observedAt: createdAt,
      },
      createdAt,
      complete,
      completion,
      lastUtilityProgressSequence: 0,
    };
    this.#jobs.set(record.reference.id, record);
    this.#queue.push(record);
    this.#emit(record);
    queueMicrotask(() => void this.#pump());
    return { ok: true, data: this.#snapshot(record) };
  }

  list(owner: number): HostEnvelope<JobSnapshot[]> {
    return {
      ok: true,
      data: [...this.#jobs.values()]
        .filter((record) => record.owner === owner)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 100)
        .map((record) => this.#snapshot(record)),
    };
  }

  cancel(owner: number, raw: unknown): HostEnvelope<JobSnapshot> {
    const resolved = this.#resolveTask(owner, raw);
    if (!resolved.ok) return resolved;
    const record = resolved.data;
    if (record.state === "queued") {
      const index = this.#queue.indexOf(record);
      if (index >= 0) this.#queue.splice(index, 1);
      this.#transition(record, "cancelled");
      record.finishedAt = now();
      this.#progress(
        record,
        "complete",
        100,
        "排队任务已取消，未发送到 Utility。",
        "queued-cancellable",
      );
      this.#emit(record);
      record.complete(this.#snapshot(record));
      return { ok: true, data: this.#snapshot(record) };
    }
    if (record.state === "running") {
      this.#transition(record, "cancel_requested");
      record.cancelRequestedAt = now();
      this.#progress(
        record,
        "native-execution",
        record.progress.completedUnits,
        "已请求取消；当前 Rust 原子阶段不可中断，将安全完成或失败。",
        "atomic",
      );
      this.#emit(record);
    }
    return { ok: true, data: this.#snapshot(record) };
  }

  result(owner: number, raw: unknown): HostEnvelope<JobResult> {
    const parsed = resultReferenceSchema.safeParse(raw);
    if (!parsed.success)
      return failure(
        "HOST_REFERENCE_INVALID",
        "结果引用格式无效。",
        "authority",
      );
    const record = this.#results.get(parsed.data.id);
    if (!record)
      return failure(
        "JOB_RESULT_NOT_READY",
        "任务结果不存在或尚未发布。",
        "job",
      );
    if (record.owner !== owner) {
      return failure(
        "HOST_REFERENCE_ORIGIN_MISMATCH",
        "结果引用属于其他渲染器会话。",
        "authority",
      );
    }
    if (
      !record.resultReference ||
      record.resultReference.displayLabel !== parsed.data.displayLabel ||
      record.resultReference.displayPath !== parsed.data.displayPath
    ) {
      return failure(
        "HOST_REFERENCE_INVALID",
        "结果引用显示字段被替换。",
        "authority",
      );
    }
    return record.result
      ? { ok: true, data: record.result }
      : failure("JOB_RESULT_NOT_READY", "任务结果尚未发布。", "job");
  }

  async wait(owner: number, raw: unknown): Promise<HostEnvelope<JobResult>> {
    const resolved = this.#resolveTask(owner, raw);
    if (!resolved.ok) return resolved;
    const snapshot = await resolved.data.completion;
    if (snapshot.state === "succeeded" && snapshot.result) {
      return this.result(owner, snapshot.result);
    }
    return snapshot.error
      ? { ok: false, error: snapshot.error }
      : failure(
          "JOB_RESULT_NOT_READY",
          `任务以 ${snapshot.state} 结束，没有结果。`,
          "job",
        );
  }

  subscribe(listener: (event: JobEvent, owner: number) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async shutdown(): Promise<void> {
    for (const record of this.#queue.splice(0)) {
      this.#transition(record, "cancelled");
      record.finishedAt = now();
      this.#progress(
        record,
        "complete",
        100,
        "应用退出前取消了排队任务。",
        "queued-cancellable",
      );
      this.#emit(record);
      record.complete(this.#snapshot(record));
    }
    await this.utility.shutdown();
  }

  async #pump(): Promise<void> {
    if (this.#running || this.#queue.length === 0) return;
    const record = this.#queue.shift()!;
    this.#running = record;
    this.#transition(record, "running");
    record.startedAt = now();
    this.#progress(
      record,
      "utility-startup",
      20,
      "正在确认隔离 Utility 进程。",
      "checkpoint",
    );
    this.#emit(record);
    let envelope: HostEnvelope<unknown>;
    try {
      envelope = await this.utility.execute(
        record.reference.id.replace(/^ref_/u, "job_"),
        record.utilityJob,
        (sequence, completedUnits, message) => {
          if (sequence <= record.lastUtilityProgressSequence) return;
          record.lastUtilityProgressSequence = sequence;
          this.#progress(
            record,
            "native-execution",
            completedUnits,
            message,
            "atomic",
          );
          this.#emit(record);
        },
      );
    } catch (error) {
      envelope = failure(
        "UTILITY_HANDSHAKE_FAILED",
        error instanceof Error ? error.message : "Utility startup failed.",
        "utility",
      );
    }
    if (!envelope.ok) {
      this.#fail(record, envelope.error);
    } else {
      this.#progress(
        record,
        "result-publication",
        90,
        "Main 正在验证并发布任务结果。",
        "atomic",
      );
      this.#emit(record);
      try {
        record.result = await record.publish(envelope.data);
        record.resultReference = makeReference(
          "result",
          `${record.operation} 结果`,
        ) as ResultReference;
        this.#results.set(record.resultReference.id, record);
        this.#transition(record, "succeeded");
        record.finishedAt = now();
        this.#progress(
          record,
          "complete",
          100,
          "任务已完成并发布结果。",
          "atomic",
        );
        this.#emit(record);
      } catch (error) {
        this.#fail(record, {
          code: "HOST_CONTRACT_RESPONSE_INVALID",
          kind: "publication",
          message:
            error instanceof Error ? error.message : "任务结果发布失败。",
        });
      }
    }
    record.complete(this.#snapshot(record));
    this.#running = undefined;
    queueMicrotask(() => void this.#pump());
  }

  #fail(record: JobRecord, error: HostError): void {
    this.#transition(record, "failed");
    record.error = error;
    record.finishedAt = now();
    this.#progress(
      record,
      "complete",
      100,
      `任务失败：[${error.code}] ${error.message}`,
      "atomic",
    );
    this.#emit(record);
  }

  #resolveTask(owner: number, raw: unknown): HostEnvelope<JobRecord> {
    const parsed = taskReferenceSchema.safeParse(raw);
    if (!parsed.success)
      return failure(
        "HOST_REFERENCE_INVALID",
        "任务引用格式无效。",
        "authority",
      );
    const record = this.#jobs.get(parsed.data.id);
    if (!record)
      return failure("JOB_NOT_FOUND", "任务不存在于当前应用会话。", "job");
    if (record.owner !== owner) {
      return failure(
        "HOST_REFERENCE_ORIGIN_MISMATCH",
        "任务引用属于其他渲染器会话。",
        "authority",
      );
    }
    if (
      record.reference.displayLabel !== parsed.data.displayLabel ||
      record.reference.displayPath !== parsed.data.displayPath
    ) {
      return failure(
        "HOST_REFERENCE_INVALID",
        "任务引用显示字段被替换。",
        "authority",
      );
    }
    return { ok: true, data: record };
  }

  #transition(record: JobRecord, next: JobSnapshot["state"]): void {
    if (!transitions[record.state].includes(next)) {
      throw new Error(`Invalid job transition ${record.state} -> ${next}.`);
    }
    record.state = next;
  }

  #progress(
    record: JobRecord,
    phase: JobProgress["phase"],
    completedUnits: number,
    message: string,
    interruptibility: JobProgress["interruptibility"],
  ): void {
    record.progress = {
      sequence: record.progress.sequence + 1,
      phase,
      completedUnits: Math.max(record.progress.completedUnits, completedUnits),
      totalUnits: 100,
      message,
      interruptibility,
      observedAt: now(),
    };
  }

  #snapshot(record: JobRecord): JobSnapshot {
    return {
      reference: record.reference,
      operation: record.operation,
      state: record.state,
      progress: record.progress,
      createdAt: record.createdAt,
      ...(record.startedAt ? { startedAt: record.startedAt } : {}),
      ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
      ...(record.cancelRequestedAt
        ? { cancelRequestedAt: record.cancelRequestedAt }
        : {}),
      ...(record.resultReference ? { result: record.resultReference } : {}),
      ...(record.error ? { error: record.error } : {}),
    };
  }

  #emit(record: JobRecord): void {
    const event = {
      sequence: ++this.#eventSequence,
      job: this.#snapshot(record),
    };
    for (const listener of this.#listeners) listener(event, record.owner);
  }
}
