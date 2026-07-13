import {
  HOST_CONTRACT_VERSION,
  HOST_CAPABILITIES,
  NATIVE_API_VERSION,
  NATIVE_ENGINE_VERSION,
  PROTOCOL_VERSION,
  RUNTIME_LIMITS,
  UNAVAILABLE_FEATURES,
  WORKBENCH_VERSION,
  type Asset,
  type HostEnvelope,
  type HostReference,
  type Inspection,
  type JobCreateRequest,
  type JobEvent,
  type JobResult,
  type JobSnapshot,
  type ProofHostApi,
  type ReferenceKind,
  type VerificationReport,
  type WorkbenchState,
  type Workspace,
  type WorkspaceReference,
  type WorkspaceSummary,
} from "@aigc-proof/host-contracts";

function ok<T>(data: T): HostEnvelope<T> {
  return { ok: true, data };
}

function reference<K extends ReferenceKind>(
  kind: K,
  label: string,
): HostReference<K> {
  const suffix = `${kind.replaceAll("-", "_")}_${label.replaceAll(" ", "_")}`
    .replaceAll(/[^A-Za-z0-9_]/g, "")
    .padEnd(24, "0")
    .slice(0, 48);
  return {
    id: `ref_${suffix}`,
    kind,
    displayLabel: label,
    displayPath: `MOCK:/${label}`,
  };
}

const emptyWorkspace = (): Workspace => ({
  workspace_version: "0.2.0",
  created_at: "2026-07-13T00:00:00Z",
  project: { name: "Mock project" },
  assets: [],
});

export class DeterministicMockProofHost implements ProofHostApi {
  readonly workspaceParent = reference("workspace-parent", "workspace parent");
  readonly workspaceReference = reference("workspace", "workspace");
  readonly assetReference = reference("asset", "asset.txt");
  readonly packageReference = reference("package", "proof.aigcproof");
  readonly packageOutputReference = reference("package-output", "proof output");
  readonly reportOutputReference = reference("report-output", "report output");
  readonly diagnosticReference = reference("diagnostic", "mock diagnostics");
  #jobs: JobSnapshot[] = [];
  #results = new Map<string, JobResult>();
  #listeners = new Set<(event: JobEvent) => void>();
  #jobEventSequence = 0;
  #workspace = emptyWorkspace();
  #state: WorkbenchState = {
    schemaVersion: 1,
    preferences: {},
    recentWorkspaces: [],
    recentPackages: [],
  };

  getDiagnostics() {
    return Promise.resolve(
      ok({
        reference: this.diagnosticReference,
        hostKind: "mock" as const,
        workbenchVersion: WORKBENCH_VERSION,
        contractVersion: HOST_CONTRACT_VERSION,
        nativeApiVersion: NATIVE_API_VERSION,
        engineVersion: NATIVE_ENGINE_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        supportedProtocolVersions: [PROTOCOL_VERSION],
        capabilities: [...HOST_CAPABILITIES],
        execution: {
          napiAsyncTasks: true as const,
          utilityProcessIsolation: true as const,
          progressStreaming: true as const,
          safeCancellation: false as const,
        },
        limits: RUNTIME_LIMITS,
        utility: {
          state: "healthy" as const,
          generation: 1,
          processId: 4242,
        },
        unavailableFeatures: [...UNAVAILABLE_FEATURES],
      }),
    );
  }
  chooseWorkspaceParent() {
    return Promise.resolve(this.workspaceParent);
  }
  chooseExistingWorkspace() {
    return Promise.resolve(this.workspaceReference);
  }
  chooseAsset() {
    return Promise.resolve(this.assetReference);
  }
  choosePackage() {
    return Promise.resolve(this.packageReference);
  }
  choosePackageOutput() {
    return Promise.resolve(this.packageOutputReference);
  }
  chooseReportOutput() {
    return Promise.resolve(this.reportOutputReference);
  }
  previewWorkspaceTarget(
    request: Parameters<ProofHostApi["previewWorkspaceTarget"]>[0],
  ) {
    return Promise.resolve(
      ok({
        parent: request.parent,
        folderName: request.folderName,
        displayPath: `MOCK:/${request.folderName}`,
        exists: false,
      }),
    );
  }
  initializeWorkspace(
    request: Parameters<ProofHostApi["initializeWorkspace"]>[0],
  ) {
    this.#workspace = {
      ...emptyWorkspace(),
      project: request.projectName ? { name: request.projectName } : {},
    };
    return Promise.resolve(ok(this.summary()));
  }
  loadWorkspace(_request: Parameters<ProofHostApi["loadWorkspace"]>[0]) {
    void _request;
    return Promise.resolve(ok(this.summary()));
  }
  addAsset(request: Parameters<ProofHostApi["addAsset"]>[0]) {
    const asset: Asset = {
      asset_id: "mock-asset-1",
      role: request.role,
      package_path: "assets/mock-asset-1.txt",
      original_name: "asset.txt",
      media_type: "text/plain",
      size_bytes: 4,
      sha256: "0".repeat(64),
    };
    this.#workspace = {
      ...this.#workspace,
      assets: [...this.#workspace.assets, asset],
    };
    return Promise.resolve(ok({ asset, workspace: this.#workspace }));
  }
  recordEvent(_request: Parameters<ProofHostApi["recordEvent"]>[0]) {
    void _request;
    return Promise.resolve(
      ok({
        event: {
          event_id: "mock-event-1",
          sequence: 1,
          event_type: "generation",
          created_at: "2026-07-13T00:00:00Z",
          previous_event_hash: null,
          payload: { mock: true },
          event_hash: "1".repeat(64),
        },
      }),
    );
  }
  sealPackage(_request: Parameters<ProofHostApi["sealPackage"]>[0]) {
    void _request;
    return Promise.resolve(
      ok({
        package: this.packageReference,
        displayPath: this.packageReference.displayPath!,
        manifest: { spec_version: PROTOCOL_VERSION },
      }),
    );
  }
  verifyPackage(_request: Parameters<ProofHostApi["verifyPackage"]>[0]) {
    void _request;
    const report: VerificationReport = {
      spec_version: "0.2.0",
      proof_id: "urn:uuid:00000000-0000-4000-8000-000000000000",
      verified_at: "2026-07-13T00:00:00Z",
      status: "valid",
      assurance: {
        internal_integrity: "valid",
        creator_identity: "not_verified",
        digital_signature: "not_present",
        trusted_time: "not_present",
        originality: "not_evaluated",
      },
      checks: [],
      errors: [],
      warnings: [],
    };
    return Promise.resolve(ok(report));
  }
  inspectPackage(_request: Parameters<ProofHostApi["inspectPackage"]>[0]) {
    void _request;
    const inspection: Inspection = {
      spec_version: "0.2.0",
      proof_id: "urn:uuid:00000000-0000-4000-8000-000000000000",
      created_at: "2026-07-13T00:00:00Z",
      project: {},
      assets: this.#workspace.assets,
      event_chain: {
        algorithm: "sha-256",
        event_count: 1,
        root_hash: "1".repeat(64),
      },
      assurance_level: "internal_integrity",
      verification_performed: false,
    };
    return Promise.resolve(ok(inspection));
  }
  saveReport(_request: Parameters<ProofHostApi["saveReport"]>[0]) {
    void _request;
    return Promise.resolve(
      ok({ displayPath: this.reportOutputReference.displayPath! }),
    );
  }
  getState() {
    return Promise.resolve(ok(this.#state));
  }
  setPreference(request: Parameters<ProofHostApi["setPreference"]>[0]) {
    this.#state = {
      ...this.#state,
      preferences: { ...this.#state.preferences, [request.key]: request.value },
    };
    return Promise.resolve(ok(this.#state));
  }
  rebuildRecents() {
    return Promise.resolve(ok(this.#state));
  }
  async startJob(request: JobCreateRequest) {
    const createdAt = "2026-07-13T00:00:00Z";
    const task = reference("task", `${request.operation} task`);
    const queued: JobSnapshot = {
      reference: task,
      operation: request.operation,
      state: "queued",
      progress: {
        sequence: 1,
        phase: "queued",
        completedUnits: 10,
        totalUnits: 100,
        message: "Mock job queued.",
        interruptibility: "queued-cancellable",
        observedAt: createdAt,
      },
      createdAt,
    };
    this.#jobs.unshift(queued);
    this.emitJob(queued);
    let execution: HostEnvelope<JobResult>;
    switch (request.operation) {
      case "initializeWorkspace": {
        const response = await this.initializeWorkspace({
          parent: request.input.parent,
          folderName: request.input.folderName,
          ...(request.input.projectName
            ? { projectName: request.input.projectName }
            : {}),
        });
        execution = response.ok
          ? ok({ operation: request.operation, data: response.data })
          : response;
        break;
      }
      case "loadWorkspace": {
        const response = await this.loadWorkspace(request.input);
        execution = response.ok
          ? ok({ operation: request.operation, data: response.data })
          : response;
        break;
      }
      case "addAsset": {
        const response = await this.addAsset(request.input);
        execution = response.ok
          ? ok({ operation: request.operation, data: response.data })
          : response;
        break;
      }
      case "recordEvent": {
        const response = await this.recordEvent(request.input);
        execution = response.ok
          ? ok({ operation: request.operation, data: response.data })
          : response;
        break;
      }
      case "sealPackage": {
        const response = await this.sealPackage(request.input);
        execution = response.ok
          ? ok({ operation: request.operation, data: response.data })
          : response;
        break;
      }
      case "verifyPackage": {
        const response = await this.verifyPackage(request.input);
        execution = response.ok
          ? ok({ operation: request.operation, data: response.data })
          : response;
        break;
      }
      case "inspectPackage": {
        const response = await this.inspectPackage(request.input);
        execution = response.ok
          ? ok({ operation: request.operation, data: response.data })
          : response;
        break;
      }
      case "rebuildRecents": {
        const response = await this.rebuildRecents();
        execution = response.ok
          ? ok({ operation: request.operation, data: response.data })
          : response;
        break;
      }
    }
    const finishedAt = "2026-07-13T00:00:01Z";
    const finished: JobSnapshot = execution.ok
      ? {
          ...queued,
          state: "succeeded",
          progress: {
            sequence: 2,
            phase: "complete",
            completedUnits: 100,
            totalUnits: 100,
            message: "Mock job completed.",
            interruptibility: "atomic",
            observedAt: finishedAt,
          },
          startedAt: createdAt,
          finishedAt,
          result: reference("result", `${request.operation} result`),
        }
      : {
          ...queued,
          state: "failed",
          progress: {
            sequence: 2,
            phase: "complete",
            completedUnits: 100,
            totalUnits: 100,
            message: "Mock job failed.",
            interruptibility: "atomic",
            observedAt: finishedAt,
          },
          startedAt: createdAt,
          finishedAt,
          error: execution.error,
        };
    this.#jobs[0] = finished;
    if (execution.ok && finished.result) {
      this.#results.set(finished.result.id, execution.data);
    }
    this.emitJob(finished);
    return ok(finished);
  }
  getJobs() {
    return Promise.resolve(ok([...this.#jobs]));
  }
  getJobResult(request: Parameters<ProofHostApi["getJobResult"]>[0]) {
    const result = this.#results.get(request.result.id);
    return Promise.resolve(
      result
        ? ok(result)
        : {
            ok: false as const,
            error: {
              code: "JOB_RESULT_NOT_READY",
              kind: "job",
              message: "Mock result not found.",
            },
          },
    );
  }
  cancelJob(request: Parameters<ProofHostApi["cancelJob"]>[0]) {
    const job = this.#jobs.find(
      (candidate) => candidate.reference.id === request.job.id,
    );
    return Promise.resolve(
      job
        ? ok(job)
        : {
            ok: false as const,
            error: {
              code: "JOB_NOT_FOUND",
              kind: "job",
              message: "Mock job not found.",
            },
          },
    );
  }
  subscribeJobEvents(
    listener: Parameters<ProofHostApi["subscribeJobEvents"]>[0],
  ) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  closeApp() {
    return Promise.resolve();
  }

  private summary(): WorkspaceSummary {
    return {
      reference: this.workspaceReference as WorkspaceReference,
      displayPath: this.workspaceReference.displayPath!,
      workspace: this.#workspace,
    };
  }

  private emitJob(job: JobSnapshot): void {
    const event = { sequence: ++this.#jobEventSequence, job };
    for (const listener of this.#listeners) listener(event);
  }
}
