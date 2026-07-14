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
  type CreationSessionEvent,
  type CreationSessionSummary,
  type HostEnvelope,
  type HostReference,
  type Inspection,
  type ImageMatchResult,
  type JobCreateRequest,
  type JobEvent,
  type JobResult,
  type JobSnapshot,
  type ProofHostApi,
  type ProviderInstallationSummary,
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
  readonly imageReference = reference("image", "created.png");
  readonly imageOutputReference = reference("image-output", "saved.png");
  readonly packageReference = reference("package", "proof.aigcproof");
  readonly packageOutputReference = reference("package-output", "proof output");
  readonly reportOutputReference = reference("report-output", "report output");
  readonly diagnosticReference = reference("diagnostic", "mock diagnostics");
  readonly providerReference = reference(
    "provider-installation",
    "ComfyUI portable",
  );
  readonly creationReference = reference(
    "creation-session",
    "Mock creation session",
  );
  #jobs: JobSnapshot[] = [];
  #results = new Map<string, JobResult>();
  #listeners = new Set<(event: JobEvent) => void>();
  #creationListeners = new Set<(event: CreationSessionEvent) => void>();
  #jobEventSequence = 0;
  #creationEventSequence = 0;
  #creationSession: CreationSessionSummary | undefined;
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
  chooseProviderInstallation() {
    return Promise.resolve(this.providerReference);
  }
  inspectProviderInstallation(
    _request: Parameters<ProofHostApi["inspectProviderInstallation"]>[0],
  ) {
    void _request;
    const summary: ProviderInstallationSummary = {
      reference: this.providerReference,
      displayPath: this.providerReference.displayPath!,
      provider: "comfyui-local",
      detectedVersion: "0.27.0",
      endpoint: "http://127.0.0.1:8188",
      compatible: true,
      checkpoints: ["mock-model.safetensors"],
      customNodeCount: 0,
      license: {
        name: "GNU General Public License v3.0",
        spdx: "GPL-3.0-only",
        sha256: "a".repeat(64),
      },
    };
    return Promise.resolve(ok(summary));
  }
  createCreationSession(
    request: Parameters<ProofHostApi["createCreationSession"]>[0],
  ) {
    this.#creationSession = {
      reference: this.creationReference,
      title: request.title,
      state: "draft",
      workspace: this.workspaceReference,
      workspaceDisplayPath: this.workspaceReference.displayPath!,
      providerInstallation: this.providerReference,
      providerVersion: "0.27.0",
      createdAt: "2026-07-14T00:00:00Z",
      updatedAt: "2026-07-14T00:00:00Z",
    };
    this.emitCreation(this.#creationSession);
    return Promise.resolve(ok(this.#creationSession));
  }
  getCreationSessions() {
    return Promise.resolve(
      ok(this.#creationSession ? [this.#creationSession] : []),
    );
  }
  freezeCreationSession(
    request: Parameters<ProofHostApi["freezeCreationSession"]>[0],
  ) {
    if (!this.#creationSession) throw new Error("Mock session missing.");
    const snapshot = {
      snapshot_version: "1.0.0" as const,
      provider: "comfyui-local" as const,
      provider_version: "0.27.0",
      workflow_template_id: "comfyui-core-text-to-image-v1" as const,
      workflow_template_sha256:
        "623d53adee2d221ea3fd62ffa2749466e742c948d190eed7c00f39db1cba4206" as const,
      checkpoint_observation: request.checkpointObservation,
      seed: request.seed,
      parameters: request.parameters,
      prompt_disclosure: request.promptDisclosure,
      ...(request.promptDisclosure === "included"
        ? { prompt: request.prompt, negative_prompt: request.negativePrompt }
        : {}),
      prompt_sha256: "b".repeat(64),
      negative_prompt_sha256: "c".repeat(64),
      parameters_sha256: "d".repeat(64),
      snapshot_sha256: "e".repeat(64),
    };
    this.#creationSession = {
      ...this.#creationSession,
      state: "frozen",
      snapshot,
      updatedAt: "2026-07-14T00:00:01Z",
      progress: {
        completedUnits: 0,
        totalUnits: 100,
        message: "Mock snapshot frozen.",
      },
    };
    this.emitCreation(this.#creationSession);
    return Promise.resolve(ok(this.#creationSession));
  }
  runCreationSession(
    _request: Parameters<ProofHostApi["runCreationSession"]>[0],
  ) {
    void _request;
    if (!this.#creationSession) throw new Error("Mock session missing.");
    const asset: Asset = {
      asset_id: "mock-created-output",
      role: "output",
      package_path: "assets/mock-created-output.png",
      original_name: "created.png",
      media_type: "image/png",
      size_bytes: 16,
      sha256: "f".repeat(64),
    };
    this.#workspace = {
      ...this.#workspace,
      assets: [...this.#workspace.assets, asset],
    };
    this.#creationSession = {
      ...this.#creationSession,
      state: "proof_ready",
      providerJobId: "mock-provider-job",
      output: {
        asset,
        mediaType: "image/png",
        sizeBytes: 16,
        sha256: asset.sha256,
        previewDataUrl: "data:image/png;base64,aGVsbG8=",
      },
      updatedAt: "2026-07-14T00:00:02Z",
      progress: {
        completedUnits: 100,
        totalUnits: 100,
        message: "Mock output automatically ingested.",
      },
    };
    this.emitCreation(this.#creationSession);
    return Promise.resolve(ok(this.#creationSession));
  }
  cancelCreationSession(
    _request: Parameters<ProofHostApi["cancelCreationSession"]>[0],
  ) {
    void _request;
    if (!this.#creationSession) throw new Error("Mock session missing.");
    this.#creationSession = {
      ...this.#creationSession,
      state: "cancelled",
      updatedAt: "2026-07-14T00:00:03Z",
    };
    this.emitCreation(this.#creationSession);
    return Promise.resolve(ok(this.#creationSession));
  }
  async completeCreationProof(
    _request: Parameters<ProofHostApi["completeCreationProof"]>[0],
  ) {
    void _request;
    if (!this.#creationSession) throw new Error("Mock session missing.");
    const verified = await this.verifyPackage({
      package: this.packageReference,
    });
    if (!verified.ok) return verified;
    const verification = verified.data;
    this.#creationSession = {
      ...this.#creationSession,
      state: "complete",
      package: this.packageReference,
      packageDisplayPath: this.packageReference.displayPath!,
      reportDisplayPath: this.reportOutputReference.displayPath!,
      verification,
      updatedAt: "2026-07-14T00:00:04Z",
    };
    this.emitCreation(this.#creationSession);
    return ok(this.#creationSession);
  }
  subscribeCreationEvents(
    listener: Parameters<ProofHostApi["subscribeCreationEvents"]>[0],
  ) {
    this.#creationListeners.add(listener);
    return () => this.#creationListeners.delete(listener);
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
  chooseImage() {
    return Promise.resolve(this.imageReference);
  }
  chooseCreationOutput(
    _request: Parameters<ProofHostApi["chooseCreationOutput"]>[0],
  ) {
    void _request;
    return Promise.resolve(this.imageOutputReference);
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
  exportCreationOutput(
    _request: Parameters<ProofHostApi["exportCreationOutput"]>[0],
  ) {
    void _request;
    const output = this.#creationSession?.output;
    if (!output) throw new Error("Mock output missing.");
    return Promise.resolve(
      ok({
        image: this.imageReference,
        displayPath: this.imageReference.displayPath!,
        mediaType: output.mediaType,
        sizeBytes: output.sizeBytes,
        sha256: output.sha256,
      }),
    );
  }
  async matchImageToPackage(
    _request: Parameters<ProofHostApi["matchImageToPackage"]>[0],
  ) {
    void _request;
    const verification = await this.verifyPackage({
      package: this.packageReference,
    });
    if (!verification.ok) return verification;
    const asset =
      this.#creationSession?.output?.asset ??
      ({
        asset_id: "mock-created-output",
        role: "output",
        package_path: "assets/output/mock-created-output.png",
        original_name: "created.png",
        media_type: "image/png",
        size_bytes: 16,
        sha256: "f".repeat(64),
      } satisfies Asset);
    const result: ImageMatchResult = {
      status: "verified_output_match",
      verification: verification.data,
      image: {
        displayLabel: this.imageReference.displayLabel,
        displayPath: this.imageReference.displayPath!,
        mediaType: "image/png",
        sizeBytes: asset.size_bytes,
        sha256: asset.sha256,
        previewDataUrl: "data:image/png;base64,aGVsbG8=",
      },
      matchedAssets: [asset],
    };
    return ok(result);
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
      case "exportWorkspaceOutput": {
        const response = await this.exportCreationOutput({
          session: this.creationReference,
          output: request.input.output,
        });
        execution = response.ok
          ? ok({ operation: request.operation, data: response.data })
          : response;
        break;
      }
      case "matchImageToPackage": {
        const response = await this.matchImageToPackage(request.input);
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

  private emitCreation(session: CreationSessionSummary): void {
    const event = { sequence: ++this.#creationEventSequence, session };
    for (const listener of this.#creationListeners) listener(event);
  }
}
