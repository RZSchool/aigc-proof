import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AssetRole,
  BridgeEnvelope,
  C2paInspection,
  C2paSidecarReference,
  C2paTrustProfileSummary,
  CreationSessionSummary,
  HostDiagnostics,
  HostReference,
  ImageMatchResult,
  ImageReference,
  Inspection,
  JobSnapshot,
  LocalSignerStatus,
  PackageOutputReference,
  PackageReference,
  ProofHostApi,
  ProviderInstallationReference,
  ProviderInstallationSummary,
  ReportOutputReference,
  TimestampPackageOutputReference,
  TsaProfileSummary,
  VerificationReport,
  WorkbenchState,
  WorkspaceParentReference,
  WorkspaceReference,
  WorkspaceSummary,
  WorkspaceTargetPreview,
} from "../shared/contracts";
import { StandaloneProofHostAdapter } from "./standalone-host";

const roles: Array<{ value: AssetRole; label: string }> = [
  { value: "output", label: "生成结果（output）" },
  { value: "input", label: "输入素材（input，不是生成结果）" },
  { value: "reference", label: "参考素材（reference）" },
  { value: "license", label: "许可文件（license）" },
  { value: "other", label: "其他材料（other）" },
];

const jobStateLabels: Record<JobSnapshot["state"], string> = {
  queued: "排队中",
  running: "运行中",
  cancel_requested: "已请求取消",
  succeeded: "已成功",
  failed: "已失败",
  cancelled: "已取消",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function errorGuidance(code: string, fallback: string): string {
  switch (code) {
    case "WORKSPACE_ALREADY_EXISTS":
      return "目标文件夹已存在，未进行任何修改。若它是有效工作区，请使用“打开已有工作区”。";
    case "WORKSPACE_FOLDER_NAME_INVALID":
    case "IPC_REQUEST_INVALID":
      return "请输入一个新的可移植文件夹名，不能包含分隔符、保留设备名或尾随点/空格。";
    case "INVALID_WORKSPACE":
    case "WORKSPACE_JSON_MALFORMED":
    case "WORKSPACE_SCHEMA_INVALID":
      return "所选文件夹不是有效的 AIGC-Proof 工作区。";
    case "HOST_REFERENCE_REUSED":
      return "该一次性选择已使用，请重新选择文件或输出位置。";
    case "UTILITY_PROCESS_LOST":
      return "隔离 Utility 意外退出；任务没有自动重放。后续任务将启动新的兼容 Utility。";
    default:
      return fallback;
  }
}

export function App({ host }: { host?: ProofHostApi } = {}) {
  const proofHost = useMemo(
    () => host ?? new StandaloneProofHostAdapter(window.aigcProof),
    [host],
  );
  const [busy, setBusy] = useState<string>();
  const [activeOperations, setActiveOperations] = useState(0);
  const [result, setResult] = useState(
    "工作台已就绪。所有证明操作均在本机离线执行。",
  );
  const [resultKind, setResultKind] = useState<"idle" | "success" | "error">(
    "idle",
  );
  const [state, setState] = useState<WorkbenchState>();
  const [diagnostics, setDiagnostics] = useState<HostDiagnostics>();
  const [signerStatus, setSignerStatus] = useState<LocalSignerStatus>();
  const [signerLabel, setSignerLabel] = useState("");
  const signerFingerprintRef = useRef<HTMLInputElement>(null);
  const [confirmSealSignature, setConfirmSealSignature] = useState(false);
  const [confirmCreationSignature, setConfirmCreationSignature] =
    useState(false);
  const [jobs, setJobs] = useState<JobSnapshot[]>([]);
  const [workspacePath, setWorkspacePath] = useState("");
  const [createParent, setCreateParent] = useState("");
  const [createParentReference, setCreateParentReference] =
    useState<WorkspaceParentReference>();
  const [workspaceFolderName, setWorkspaceFolderName] = useState("");
  const [workspaceTarget, setWorkspaceTarget] =
    useState<WorkspaceTargetPreview>();
  const [workspaceTargetError, setWorkspaceTargetError] = useState("");
  const [openWorkspacePath, setOpenWorkspacePath] = useState("");
  const [openWorkspaceReference, setOpenWorkspaceReference] =
    useState<WorkspaceReference>();
  const [projectName, setProjectName] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceSummary>();
  const [workspaceScopeReady, setWorkspaceScopeReady] = useState(false);
  const workspaceScopeGeneration = useRef(0);
  const [assetPath, setAssetPath] = useState("");
  const [assetReference, setAssetReference] =
    useState<HostReference<"asset">>();
  const [assetRole, setAssetRole] = useState<AssetRole>("output");
  const [imagePath, setImagePath] = useState("");
  const [imageReference, setImageReference] = useState<ImageReference>();
  const [imageMatch, setImageMatch] = useState<ImageMatchResult>();
  const [imagePrefillSessionId, setImagePrefillSessionId] = useState<string>();
  const [eventType, setEventType] = useState("generation");
  const [payloadJson, setPayloadJson] = useState(
    '{\n  "model": "local-model"\n}',
  );
  const [sealOutput, setSealOutput] = useState("");
  const [sealOutputReference, setSealOutputReference] =
    useState<PackageOutputReference>();
  const [packagePath, setPackagePath] = useState("");
  const [packageReference, setPackageReference] = useState<PackageReference>();
  const [reportPath, setReportPath] = useState("");
  const [reportOutputReference, setReportOutputReference] =
    useState<ReportOutputReference>();
  const [report, setReport] = useState<VerificationReport>();
  const [inspection, setInspection] = useState<Inspection>();
  const [tsaProfile, setTsaProfile] = useState<TsaProfileSummary>();
  const [tsaProfilePath, setTsaProfilePath] = useState("");
  const [timestampOutputPath, setTimestampOutputPath] = useState("");
  const [timestampOutputReference, setTimestampOutputReference] =
    useState<TimestampPackageOutputReference>();
  const [c2paProfile, setC2paProfile] = useState<C2paTrustProfileSummary>();
  const [c2paProfilePath, setC2paProfilePath] = useState("");
  const [c2paImage, setC2paImage] = useState<ImageReference>();
  const [c2paImagePath, setC2paImagePath] = useState("");
  const [c2paSidecar, setC2paSidecar] = useState<C2paSidecarReference>();
  const [c2paSidecarPath, setC2paSidecarPath] = useState("");
  const [c2paAssetId, setC2paAssetId] = useState("");
  const [c2paInspection, setC2paInspection] = useState<C2paInspection>();
  const [providerPath, setProviderPath] = useState("");
  const [providerReference, setProviderReference] =
    useState<ProviderInstallationReference>();
  const [provider, setProvider] = useState<ProviderInstallationSummary>();
  const [creationSessions, setCreationSessions] = useState<
    CreationSessionSummary[]
  >([]);
  const [creationSession, setCreationSession] =
    useState<CreationSessionSummary>();
  const [creationTitle, setCreationTitle] = useState("本地创作会话");
  const [creationPrompt, setCreationPrompt] = useState("");
  const [creationNegativePrompt, setCreationNegativePrompt] = useState("");
  const [creationCheckpoint, setCreationCheckpoint] = useState("");
  const [creationSeed, setCreationSeed] = useState("42");
  const [creationWidth, setCreationWidth] = useState("512");
  const [creationHeight, setCreationHeight] = useState("512");
  const [creationSteps, setCreationSteps] = useState("20");
  const [creationCfg, setCreationCfg] = useState("7");
  const [creationSampler, setCreationSampler] = useState<
    "euler" | "euler_ancestral" | "dpmpp_2m"
  >("euler");
  const [creationScheduler, setCreationScheduler] = useState<
    "normal" | "karras" | "simple"
  >("normal");
  const [creationDisclosure, setCreationDisclosure] = useState<
    "included" | "digest-only"
  >("included");
  const [creationPackagePath, setCreationPackagePath] = useState("");
  const [creationPackageOutput, setCreationPackageOutput] =
    useState<PackageOutputReference>();
  const [creationReportPath, setCreationReportPath] = useState("");
  const [creationReportOutput, setCreationReportOutput] =
    useState<ReportOutputReference>();

  useEffect(() => {
    let active = true;
    void proofHost.getState().then((response) => {
      if (!active) return;
      if (response.ok) {
        setState(response.data);
        document.documentElement.dataset.theme =
          response.data.preferences.theme ?? "light";
      } else {
        showFailure(response);
      }
    });
    void proofHost.getDiagnostics().then((response) => {
      if (active && response.ok) setDiagnostics(response.data);
      else if (active) showFailure(response);
    });
    void proofHost.getSignerStatus().then((response) => {
      if (active && response.ok) {
        setSignerStatus(response.data);
        setSignerLabel(response.data.display_label ?? "");
      } else if (active) showFailure(response);
    });
    void proofHost.getJobs().then((response) => {
      if (active && response.ok) setJobs(response.data);
    });
    void proofHost.getTsaProfileStatus().then((response) => {
      if (active && response.ok) setTsaProfile(response.data ?? undefined);
    });
    void proofHost.getC2paTrustProfileStatus().then((response) => {
      if (active && response.ok) setC2paProfile(response.data ?? undefined);
    });
    const unsubscribe = proofHost.subscribeJobEvents((event) => {
      if (!active) return;
      setJobs((current) => {
        const next = current.filter(
          (job) => job.reference.id !== event.job.reference.id,
        );
        return [event.job, ...next].slice(0, 100);
      });
      if (["succeeded", "failed", "cancelled"].includes(event.job.state)) {
        void proofHost.getDiagnostics().then((response) => {
          if (active && response.ok) setDiagnostics(response.data);
        });
      }
    });
    const unsubscribeCreation = proofHost.subscribeCreationEvents((event) => {
      if (!active) return;
      setCreationSessions((current) => [
        event.session,
        ...current.filter(
          (session) => session.reference.id !== event.session.reference.id,
        ),
      ]);
      setCreationSession((current) =>
        current?.reference.id === event.session.reference.id
          ? event.session
          : current,
      );
    });
    return () => {
      active = false;
      unsubscribe();
      unsubscribeCreation();
    };
  }, [proofHost]);

  useEffect(() => {
    let active = true;
    if (!createParentReference || !workspaceFolderName) {
      setWorkspaceTarget(undefined);
      setWorkspaceTargetError("");
      return () => {
        active = false;
      };
    }
    void proofHost
      .previewWorkspaceTarget({
        parent: createParentReference,
        folderName: workspaceFolderName,
      })
      .then((response) => {
        if (!active) return;
        if (response.ok) {
          setWorkspaceTarget(response.data);
          setWorkspaceTargetError("");
        } else {
          setWorkspaceTarget(undefined);
          setWorkspaceTargetError(response.error.message);
        }
      });
    return () => {
      active = false;
    };
  }, [createParentReference, proofHost, workspaceFolderName]);

  function showFailure<T>(response: BridgeEnvelope<T>): void {
    if (!response.ok) {
      setResultKind("error");
      setResult(
        `[${response.error.code}] ${errorGuidance(response.error.code, response.error.message)}` +
          (response.error.displayPath ? `\n${response.error.displayPath}` : ""),
      );
    }
  }

  function showSuccess(title: string, value: unknown): void {
    setResultKind("success");
    setResult(
      `${title}\n\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`,
    );
  }

  async function run(
    label: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    setActiveOperations((count) => count + 1);
    setBusy(label);
    setResultKind("idle");
    setResult(`${label}…`);
    try {
      await operation();
      const refreshed = await proofHost.getState();
      if (refreshed.ok) setState(refreshed.data);
    } catch (error) {
      setResultKind("error");
      setResult(error instanceof Error ? error.message : "操作失败。");
    } finally {
      setActiveOperations((count) => {
        const next = Math.max(0, count - 1);
        if (next === 0) setBusy(undefined);
        return next;
      });
    }
  }

  async function choose<K extends HostReference>(
    setReference: (value: K) => void,
    setDisplay: (value: string) => void,
    picker: () => Promise<K | null>,
  ) {
    const selected = await picker();
    if (selected) {
      setReference(selected);
      setDisplay(selected.displayPath ?? selected.displayLabel);
    }
  }

  function clearImageVerification(): void {
    setImagePath("");
    setImageReference(undefined);
    setImageMatch(undefined);
    setImagePrefillSessionId(undefined);
  }

  function clearPackageContext(): void {
    setPackagePath("");
    setPackageReference(undefined);
    setReportPath("");
    setReportOutputReference(undefined);
    setReport(undefined);
    setInspection(undefined);
  }

  function clearCreationDependentState(): void {
    setCreationSession(undefined);
    setCreationPackagePath("");
    setCreationPackageOutput(undefined);
    setCreationReportPath("");
    setCreationReportOutput(undefined);
    clearImageVerification();
    clearPackageContext();
  }

  function resetCreationForm(): void {
    setCreationTitle("本地创作会话");
    setCreationPrompt("");
    setCreationNegativePrompt("");
    setCreationCheckpoint(provider?.checkpoints[0] ?? "");
    setCreationSeed("42");
    setCreationWidth("512");
    setCreationHeight("512");
    setCreationSteps("20");
    setCreationCfg("7");
    setCreationSampler("euler");
    setCreationScheduler("normal");
    setCreationDisclosure("included");
  }

  function applyCreationForm(session: CreationSessionSummary): void {
    setCreationTitle(session.title);
    const snapshot = session.snapshot;
    if (!snapshot) {
      setCreationPrompt("");
      setCreationNegativePrompt("");
      return;
    }
    setCreationCheckpoint(snapshot.checkpoint_observation);
    setCreationPrompt(snapshot.prompt ?? "");
    setCreationNegativePrompt(snapshot.negative_prompt ?? "");
    setCreationDisclosure(snapshot.prompt_disclosure);
    setCreationSeed(String(snapshot.seed));
    setCreationWidth(String(snapshot.parameters.width));
    setCreationHeight(String(snapshot.parameters.height));
    setCreationSteps(String(snapshot.parameters.steps));
    setCreationCfg(String(snapshot.parameters.cfg));
    setCreationSampler(snapshot.parameters.sampler);
    setCreationScheduler(snapshot.parameters.scheduler);
  }

  function resetWorkspaceTransientState(): void {
    setWorkspaceScopeReady(false);
    setCreationSessions([]);
    clearCreationDependentState();
    resetCreationForm();
    setAssetPath("");
    setAssetReference(undefined);
    setSealOutput("");
    setSealOutputReference(undefined);
    setResultKind("idle");
    setResult("正在建立新的工作区界面作用域…");
  }

  async function enterWorkspaceScope(
    summary: WorkspaceSummary,
  ): Promise<boolean> {
    const generation = ++workspaceScopeGeneration.current;
    resetWorkspaceTransientState();
    setWorkspace(summary);
    setWorkspacePath(summary.displayPath);
    setOpenWorkspacePath(summary.displayPath);
    setOpenWorkspaceReference(summary.reference);
    const response = await proofHost.getCreationSessions({
      workspace: summary.reference,
    });
    if (generation !== workspaceScopeGeneration.current) return false;
    if (!response.ok) {
      showFailure(response);
      return false;
    }
    setCreationSessions(response.data);
    setWorkspaceScopeReady(true);
    return true;
  }

  function restoreCreationSession(session: CreationSessionSummary): void {
    clearCreationDependentState();
    applyCreationForm(session);
    setCreationSession(session);
    setCreationPackagePath(session.packageDisplayPath ?? "");
    setCreationReportPath(session.reportDisplayPath ?? "");
    if (session.package && session.packageDisplayPath) {
      setPackageReference(session.package);
      setPackagePath(session.packageDisplayPath);
    }
    if (session.verification) setReport(session.verification);
    showSuccess("已恢复当前工作区的历史会话", {
      title: session.title,
      state: session.state,
      updatedAt: session.updatedAt,
    });
  }

  async function chooseImageForVerification(): Promise<void> {
    const selected = await proofHost.chooseImage();
    if (!selected) return;
    setImageReference(selected);
    setImagePath(selected.displayPath ?? selected.displayLabel);
    setImageMatch(undefined);
    setImagePrefillSessionId(undefined);
  }

  async function choosePackageForVerification(): Promise<void> {
    const selected = await proofHost.choosePackage();
    if (!selected) return;
    setPackageReference(selected);
    setPackagePath(selected.displayPath ?? selected.displayLabel);
    setImageMatch(undefined);
    setReport(undefined);
    setInspection(undefined);
  }

  async function importTsaProfile(): Promise<void> {
    const selected = await proofHost.chooseTsaProfile();
    if (!selected) return;
    await run("Importing TSA trust snapshot", async () => {
      const response = await proofHost.importTsaProfile({ profile: selected });
      if (!response.ok) return showFailure(response);
      setTsaProfile(response.data);
      setTsaProfilePath(selected.displayPath ?? selected.displayLabel);
      showSuccess("TSA trust snapshot imported", response.data);
    });
  }

  async function importC2paProfile(): Promise<void> {
    const selected = await proofHost.chooseC2paTrustProfile();
    if (!selected) return;
    await run("Importing C2PA trust profile", async () => {
      const response = await proofHost.importC2paTrustProfile({
        profile: selected,
      });
      if (!response.ok) return showFailure(response);
      setC2paProfile(response.data);
      setC2paProfilePath(selected.displayPath ?? selected.displayLabel);
      showSuccess("C2PA trust profile imported", response.data);
    });
  }

  async function chooseC2paImage(): Promise<void> {
    const selected = await proofHost.chooseC2paImage();
    if (!selected) return;
    setC2paImage(selected);
    setC2paImagePath(selected.displayPath ?? selected.displayLabel);
    setC2paInspection(undefined);
  }

  async function chooseC2paSidecar(): Promise<void> {
    const selected = await proofHost.chooseC2paSidecar();
    if (!selected) return;
    setC2paSidecar(selected);
    setC2paSidecarPath(selected.displayPath ?? selected.displayLabel);
    setC2paInspection(undefined);
  }

  async function inspectC2pa(): Promise<void> {
    await run("Inspecting Content Credentials offline", async () => {
      if (!c2paImage)
        throw new Error("Select a JPEG, PNG or WebP image first.");
      const response = await proofHost.inspectC2paImage({
        image: c2paImage,
        ...(c2paSidecar ? { sidecar: c2paSidecar } : {}),
      });
      if (!response.ok) return showFailure(response);
      setC2paInspection(response.data);
      showSuccess("C2PA observation preview created", response.data);
    });
  }

  async function createC2paObservation(): Promise<void> {
    await run("Recording digest-bound C2PA observation", async () => {
      if (!workspace || !c2paAssetId) {
        throw new Error(
          "Open a workspace and select an ingested image asset first.",
        );
      }
      const response = await proofHost.createC2paObservation({
        workspace: workspace.reference,
        assetId: c2paAssetId,
        ...(c2paSidecar ? { sidecar: c2paSidecar } : {}),
      });
      if (!response.ok) return showFailure(response);
      setWorkspace({ ...workspace, workspace: response.data.workspace });
      showSuccess(
        "Digest-bound C2PA observation recorded",
        response.data.event,
      );
    });
  }

  async function requestTrustedTimestamp(): Promise<void> {
    await run("Requesting RFC 3161 trusted time", async () => {
      if (!packageReference || !timestampOutputReference) {
        throw new Error(
          "Select a protocol 0.4 package and a new timestamped-package output.",
        );
      }
      const response = await proofHost.requestTrustedTimestamp({
        package: packageReference,
        output: timestampOutputReference,
        confirmDisclosure: true,
      });
      if (!response.ok) {
        const verified = await proofHost.verifyPackage({
          package: packageReference,
        });
        if (verified.ok) {
          setReport({
            ...verified.data,
            assurance: {
              ...verified.data.assurance,
              trusted_time: "acquisition_failed",
            },
            warnings: [
              ...verified.data.warnings,
              {
                code: "TSA_ACQUISITION_FAILED",
                message:
                  "The explicit trusted-time request failed or was cancelled; creator-signature validity is unchanged.",
              },
            ],
          });
        }
        return showFailure(response);
      }
      setPackageReference(response.data.package);
      setPackagePath(response.data.displayPath);
      setTimestampOutputReference(undefined);
      setTimestampOutputPath("");
      const verified = await proofHost.verifyPackage({
        package: response.data.package,
      });
      if (verified.ok) setReport(verified.data);
      showSuccess("Trusted timestamp attached and verified", response.data);
    });
  }

  async function initializeWorkspace(): Promise<void> {
    await run("正在初始化工作区", async () => {
      if (!createParentReference) throw new Error("请先选择父文件夹。");
      const response = await proofHost.initializeWorkspace({
        parent: createParentReference,
        folderName: workspaceFolderName,
        ...(projectName.trim() ? { projectName: projectName.trim() } : {}),
      });
      if (!response.ok) return showFailure(response);
      if (await enterWorkspaceScope(response.data)) {
        showSuccess("工作区已创建，创作状态已重置", response.data);
      }
    });
  }

  async function openWorkspace(
    reference = openWorkspaceReference,
  ): Promise<void> {
    await run("正在打开工作区", async () => {
      if (!reference) throw new Error("请先选择已有工作区。");
      const response = await proofHost.loadWorkspace({ workspace: reference });
      if (!response.ok) return showFailure(response);
      if (await enterWorkspaceScope(response.data)) {
        showSuccess("工作区已打开，创作状态已重置", response.data);
      }
    });
  }

  async function addAsset(): Promise<void> {
    await run("正在流式复制并计算 SHA-256", async () => {
      if (!workspace || !assetReference)
        throw new Error("请选择工作区和资产。");
      const response = await proofHost.addAsset({
        workspace: workspace.reference,
        source: assetReference,
        role: assetRole,
      });
      if (!response.ok) return showFailure(response);
      setWorkspace((current) =>
        current ? { ...current, workspace: response.data.workspace } : current,
      );
      setAssetReference(undefined);
      setAssetPath("");
      showSuccess("资产已添加", response.data.asset);
    });
  }

  async function verifyImageAgainstPackage(): Promise<void> {
    await run("正在验证证明包并核对图片", async () => {
      if (!imageReference || !packageReference)
        throw new Error("请同时选择图片和 .aigcproof 证明包。");
      const response = await proofHost.matchImageToPackage({
        image: imageReference,
        package: packageReference,
      });
      if (!response.ok) return showFailure(response);
      setImageMatch(response.data);
      setReport(response.data.verification);
      setInspection(undefined);
      setImageReference(undefined);
      setImagePrefillSessionId(undefined);
      const title =
        response.data.status === "verified_output_match"
          ? "图片与有效证明包中的生成输出完全一致"
          : response.data.status === "matched_non_output"
            ? "文件存在于包中，但不是生成输出"
            : response.data.status === "not_in_package"
              ? "图片不在该证明包中"
              : "证明包无效，未作图片对应性判断";
      showSuccess(title, response.data);
    });
  }

  async function exportCreationOutput(): Promise<void> {
    if (!creationSession?.output) {
      setResultKind("error");
      setResult("当前创作会话没有可导出的成功输出。");
      return;
    }
    const session = creationSession;
    const output = await proofHost.chooseCreationOutput({
      session: session.reference,
    });
    if (!output) return;
    await run("正在保存生成图片副本", async () => {
      const response = await proofHost.exportCreationOutput({
        session: session.reference,
        output,
      });
      if (!response.ok) return showFailure(response);
      setImageReference(response.data.image);
      setImagePath(response.data.displayPath);
      setImageMatch(undefined);
      setImagePrefillSessionId(session.reference.id);
      showSuccess("生成图片副本已保存，可直接与证明包核验", response.data);
    });
  }

  async function recordEvent(): Promise<void> {
    try {
      const parsed = JSON.parse(payloadJson) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error("事件载荷必须是 JSON 对象。");
      }
    } catch (error) {
      setResultKind("error");
      setResult(error instanceof Error ? error.message : "JSON 载荷无效。");
      return;
    }
    await run("正在记录事件", async () => {
      if (!workspace) throw new Error("请先打开工作区。");
      const response = await proofHost.recordEvent({
        workspace: workspace.reference,
        eventType,
        payloadJson,
      });
      if (!response.ok) return showFailure(response);
      showSuccess("事件已写入哈希链", response.data.event);
    });
  }

  async function sealPackage(): Promise<void> {
    await run("正在封装并自检证明包", async () => {
      if (!workspace || !sealOutputReference)
        throw new Error("请选择工作区和输出位置。");
      const response = await proofHost.sealPackage({
        workspace: workspace.reference,
        output: sealOutputReference,
        confirmSignature: true,
      });
      if (!response.ok) return showFailure(response);
      setPackagePath(response.data.displayPath);
      setPackageReference(response.data.package);
      setSealOutputReference(undefined);
      setConfirmSealSignature(false);
      showSuccess("证明包已封装（禁止覆盖）", response.data);
    });
  }

  async function createSigner(): Promise<void> {
    await run("正在创建本地签名身份", async () => {
      const response = await proofHost.createSigner({
        displayLabel: signerLabel.trim(),
      });
      if (!response.ok) return showFailure(response);
      setSignerStatus(response.data);
      setSignerLabel(response.data.display_label ?? "");
      showSuccess("本地签名身份已创建", response.data);
    });
  }

  async function rotateSigner(): Promise<void> {
    if (
      !window.confirm(
        "轮换将永久替换当前本地私钥。旧证明仍可验证，但不会再被标记为本机信任。确定继续吗？",
      )
    )
      return;
    await run("正在轮换本地签名身份", async () => {
      const response = await proofHost.rotateSigner({
        displayLabel: signerLabel.trim(),
        confirm: true,
      });
      if (!response.ok) return showFailure(response);
      setSignerStatus(response.data);
      setSignerLabel(response.data.display_label ?? "");
      showSuccess("本地签名密钥已轮换", response.data);
    });
  }

  async function disableSigner(): Promise<void> {
    if (
      !window.confirm(
        "禁用将从操作系统凭据库删除本地私钥，之后不能恢复或继续签名。确定继续吗？",
      )
    )
      return;
    await run("正在禁用本地签名身份", async () => {
      const response = await proofHost.disableSigner({ confirm: true });
      if (!response.ok) return showFailure(response);
      setSignerStatus(response.data);
      showSuccess("本地签名身份已禁用", response.data);
    });
  }

  function copySignerFingerprint(): void {
    const input = signerFingerprintRef.current;
    if (!input || !signerStatus?.key_fingerprint) return;
    input.focus();
    input.select();
    if (document.execCommand("copy")) {
      setResultKind("success");
      setResult("本地签名密钥的完整 SHA-256 指纹已复制。");
    } else {
      setResultKind("error");
      setResult("无法自动复制；完整指纹已选中，可手动复制。");
    }
  }

  async function verifyPackage(): Promise<void> {
    await run("正在验证包内完整性", async () => {
      if (!packageReference) throw new Error("请先选择证明包。");
      const response = await proofHost.verifyPackage({
        package: packageReference,
      });
      if (!response.ok) return showFailure(response);
      setReport(response.data);
      setInspection(undefined);
      showSuccess(`验证完成：${response.data.status}`, response.data);
    });
  }

  async function inspectPackage(): Promise<void> {
    await run("正在读取元数据（不执行验证）", async () => {
      if (!packageReference) throw new Error("请先选择证明包。");
      const response = await proofHost.inspectPackage({
        package: packageReference,
      });
      if (!response.ok) return showFailure(response);
      setInspection(response.data);
      showSuccess("元数据读取完成：未执行完整性验证", response.data);
    });
  }

  async function saveReport(): Promise<void> {
    if (!report) {
      setResultKind("error");
      setResult("请先验证证明包，再保存报告。");
      return;
    }
    await run("正在保存验证报告", async () => {
      if (!reportOutputReference) throw new Error("请选择报告保存位置。");
      const response = await proofHost.saveReport({
        output: reportOutputReference,
        report,
      });
      if (!response.ok) return showFailure(response);
      setReportOutputReference(undefined);
      showSuccess("验证报告已保存（禁止覆盖）", response.data.displayPath);
    });
  }

  async function inspectProvider(): Promise<void> {
    await run("正在核验本地 ComfyUI", async () => {
      if (!providerReference)
        throw new Error("请先选择 ComfyUI portable 安装目录。");
      const response = await proofHost.inspectProviderInstallation({
        installation: providerReference,
      });
      if (!response.ok) return showFailure(response);
      setProvider(response.data);
      setCreationCheckpoint(response.data.checkpoints[0] ?? "");
      showSuccess("本地 ComfyUI 已通过冻结能力检查", response.data);
    });
  }

  async function createSession(): Promise<void> {
    await run("正在创建创作会话", async () => {
      if (!workspace || !workspaceScopeReady || !provider)
        throw new Error("请先打开工作区并完成 ComfyUI 核验。");
      clearCreationDependentState();
      const response = await proofHost.createCreationSession({
        workspace: workspace.reference,
        installation: provider.reference,
        title: creationTitle.trim(),
      });
      if (!response.ok) return showFailure(response);
      applyCreationForm(response.data);
      setCreationSession(response.data);
      showSuccess("创作会话已创建", response.data);
    });
  }

  async function freezeSession(): Promise<void> {
    await run("正在冻结不可变创作快照", async () => {
      if (!creationSession) throw new Error("请先创建创作会话。");
      const response = await proofHost.freezeCreationSession({
        session: creationSession.reference,
        checkpointObservation: creationCheckpoint,
        prompt: creationPrompt,
        negativePrompt: creationNegativePrompt,
        promptDisclosure: creationDisclosure,
        seed: Number(creationSeed),
        parameters: {
          width: Number(creationWidth),
          height: Number(creationHeight),
          steps: Number(creationSteps),
          cfg: Number(creationCfg),
          sampler: creationSampler,
          scheduler: creationScheduler,
        },
      });
      if (!response.ok) return showFailure(response);
      setCreationSession(response.data);
      showSuccess("创作快照已冻结", response.data.snapshot);
    });
  }

  async function runSession(): Promise<void> {
    await run("ComfyUI 正在生成并自动接入证明", async () => {
      if (!creationSession) throw new Error("请先冻结创作会话。");
      const response = await proofHost.runCreationSession({
        session: creationSession.reference,
      });
      if (!response.ok) return showFailure(response);
      setCreationSession(response.data);
      const refreshed = await proofHost.loadWorkspace({
        workspace: response.data.workspace,
      });
      if (refreshed.ok) setWorkspace(refreshed.data);
      showSuccess("生成输出已自动接入，证明证据链已就绪", response.data);
    });
  }

  async function cancelSession(): Promise<void> {
    if (!creationSession) return;
    const response = await proofHost.cancelCreationSession({
      session: creationSession.reference,
    });
    if (!response.ok) return showFailure(response);
    setCreationSession(response.data);
    showSuccess("已请求取消；不会生成成功输出证明", response.data);
  }

  async function completeCreationProof(): Promise<void> {
    await run("正在封装、验证并保存创作证明", async () => {
      if (!creationSession || !creationPackageOutput || !creationReportOutput)
        throw new Error("请选择创作证明包和报告的新输出位置。");
      const response = await proofHost.completeCreationProof({
        session: creationSession.reference,
        packageOutput: creationPackageOutput,
        reportOutput: creationReportOutput,
        confirmSignature: true,
      });
      if (!response.ok) return showFailure(response);
      setCreationSession(response.data);
      setCreationPackageOutput(undefined);
      setCreationReportOutput(undefined);
      setConfirmCreationSignature(false);
      if (response.data.package && response.data.packageDisplayPath) {
        setPackageReference(response.data.package);
        setPackagePath(response.data.packageDisplayPath);
      }
      if (response.data.verification) setReport(response.data.verification);
      showSuccess("创作证明已完成并独立验证", response.data);
    });
  }

  return (
    <div className="workbench-page">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            AP
          </span>
          <div>
            <p className="eyebrow">OFFLINE PROOF WORKBENCH</p>
            <h1>AIGC-Proof</h1>
            <span data-testid="workbench-version">Workbench 0.8.0</span>
          </div>
        </div>
        <div className="header-actions">
          <span className="offline-badge">
            <i /> 离线模式
          </span>
          <button
            className="quiet-button"
            onClick={() => void proofHost.closeApp()}
          >
            退出
          </button>
        </div>
      </header>

      <section className="assurance-banner" data-testid="assurance-banner">
        <strong>能力边界：内部完整性、本地创建者数字签名与可选可信时间</strong>
        <span>
          显示名称为自我声明 · Ed25519 签名可验证 · 本机信任仅表示密钥匹配 · RFC
          3161 时间仅在显式请求并通过信任快照验证后可信 · C2PA
          为可选离线来源观察 · 原创性始终不评估
        </span>
        <small>
          不是事实真实性、实名、版权登记、公证、权属证明、原创认证或官方验证。
        </small>
      </section>

      <section className={`status-strip ${resultKind}`} aria-live="polite">
        <div className="result-heading">
          <span className={activeOperations > 0 ? "spinner" : "status-dot"} />
          <strong data-testid="result-status">
            {activeOperations > 0
              ? `${busy ?? "正在处理"}${activeOperations > 1 ? `（${activeOperations} 项）` : ""}`
              : resultKind === "error"
                ? "操作失败"
                : resultKind === "success"
                  ? "操作完成"
                  : "就绪"}
          </strong>
        </div>
        <pre data-testid="result-text">{result}</pre>
      </section>

      <main className="workflow-canvas" data-testid="unified-workflow">
        <section className="panel intro-panel" data-region="overview">
          <div>
            <p className="eyebrow">PROTOCOL 0.5.0 · ONE PAGE</p>
            <h2>生成图片、保存原图、核对证明，一页完成</h2>
            <p>
              后续步骤始终可见；不满足前置条件时会给出提示。长任务由隔离 Utility
              执行， SQLite 只保存可重建的本机工作台状态。
            </p>
          </div>
          <div className="recent-grid">
            <RecentList
              title="最近工作区"
              testId="recent-workspaces"
              items={state?.recentWorkspaces ?? []}
              onSelect={(reference) =>
                void openWorkspace(reference as WorkspaceReference)
              }
            />
            <RecentList
              title="最近证明包"
              testId="recent-packages"
              items={state?.recentPackages ?? []}
              onSelect={(reference, displayPath) => {
                setPackageReference(reference as PackageReference);
                setPackagePath(displayPath);
                document
                  .querySelector('[data-region="verify-image"]')
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            />
          </div>
        </section>

        <section
          className="panel image-verify-panel"
          data-region="verify-image"
        >
          <PanelTitle
            step="01"
            title="验证我的图片"
            hint="选择你手上的图片和证明包；先完整验证包，再核对图片是否为其中的 output"
          />
          <div className="image-verify-grid">
            <Field label="要验证的图片">
              <div className="field-row">
                <input
                  data-testid="image-path"
                  readOnly
                  placeholder="选择 PNG、JPEG 或 WebP"
                  value={imagePath}
                />
                <button
                  className="secondary"
                  data-testid="choose-image"
                  onClick={() => void chooseImageForVerification()}
                >
                  {imagePrefillSessionId ? "替换图片" : "选择图片"}
                </button>
                {imagePrefillSessionId && (
                  <button
                    className="quiet-button"
                    data-testid="clear-image-prefill"
                    onClick={clearImageVerification}
                  >
                    清除预填
                  </button>
                )}
              </div>
              {imagePrefillSessionId && (
                <small className="field-help" data-testid="image-prefill-note">
                  已由当前完成会话的“保存生成图片副本”预填；切换工作区或会话会自动清除。
                </small>
              )}
            </Field>
            <Field label="对应的 .aigcproof 证明包">
              <div className="field-row">
                <input
                  data-testid="image-package-path"
                  readOnly
                  placeholder="选择证明包"
                  value={packagePath}
                />
                <button
                  className="secondary"
                  data-testid="choose-image-package"
                  onClick={() => void choosePackageForVerification()}
                >
                  选择证明包
                </button>
              </div>
            </Field>
          </div>
          <button
            className="primary image-verify-action"
            data-testid="match-image-package"
            disabled={!imageReference || !packageReference}
            onClick={() => void verifyImageAgainstPackage()}
          >
            验证图片与证明包
          </button>
          <p className="assurance-inline">
            匹配表示图片字节与有效包内的生成输出完全一致；创建者签名与可信时间必须分别查看验证报告，不代表实名、原创性或所有权。
          </p>
          {imageMatch && (
            <article
              className={`image-match-card match-${imageMatch.status}`}
              data-testid="image-match-result"
              role="status"
            >
              {imageMatch.image.previewDataUrl && (
                <img
                  src={imageMatch.image.previewDataUrl}
                  alt={`待验证图片：${imageMatch.image.displayLabel}`}
                />
              )}
              <div>
                <strong>
                  {imageMatch.status === "verified_output_match"
                    ? "图片与包内生成输出完全一致"
                    : imageMatch.status === "matched_non_output"
                      ? "文件在包中，但角色不是生成输出"
                      : imageMatch.status === "not_in_package"
                        ? "图片不在这个证明包中"
                        : "证明包无效，不能判断图片对应关系"}
                </strong>
                <span>{imageMatch.image.displayLabel}</span>
                {imageMatch.image.sha256 && (
                  <code>{imageMatch.image.sha256}</code>
                )}
                <span>
                  包完整性：{imageMatch.verification.status} · 证明 ID：
                  {imageMatch.verification.proof_id ?? "无"}
                </span>
                {imageMatch.matchedAssets.map((asset) => (
                  <span key={asset.asset_id}>
                    匹配资产：{asset.original_name} · {asset.role} ·{" "}
                    {formatBytes(asset.size_bytes)}
                  </span>
                ))}
                <small>
                  仅确认文件与已验证证明包输出的字节对应关系；创建者签名与可信时间状态见验证报告，实名、原创性与权属仍未评估。
                </small>
              </div>
            </article>
          )}
        </section>

        <section className="panel" data-region="workspace">
          <PanelTitle
            step="02"
            title="创建或打开工作区"
            hint="创建与打开是两条独立路径，已有目标永不初始化或覆盖"
          />
          <div className="split-grid">
            <div className="subpanel">
              <h3>创建新工作区</h3>
              <Field label="父文件夹">
                <div className="field-row">
                  <input
                    aria-label="新工作区父文件夹"
                    data-testid="create-parent"
                    readOnly
                    placeholder="请选择已有父文件夹"
                    value={createParent}
                  />
                  <button
                    className="secondary"
                    data-testid="choose-create-parent"
                    onClick={() =>
                      void choose(
                        setCreateParentReference,
                        setCreateParent,
                        () => proofHost.chooseWorkspaceParent(),
                      )
                    }
                  >
                    选择
                  </button>
                </div>
              </Field>
              <Field label="新工作区文件夹名">
                <input
                  aria-describedby="workspace-name-help"
                  data-testid="workspace-folder-name"
                  placeholder="例如：项目 工作区"
                  value={workspaceFolderName}
                  onChange={(event) =>
                    setWorkspaceFolderName(event.target.value)
                  }
                  maxLength={120}
                />
                <small className="field-help" id="workspace-name-help">
                  只能填写一个文件夹名，不能包含分隔符、保留设备名或尾随点/空格。
                </small>
              </Field>
              <Field label="项目名（可选）">
                <input
                  data-testid="project-name"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  maxLength={200}
                />
              </Field>
              <div
                className={`target-preview ${workspaceTarget?.exists ? "target-exists" : ""}`}
                data-testid="workspace-target-preview"
              >
                <strong>将创建到</strong>
                <span>
                  {workspaceTarget?.displayPath ||
                    workspaceTargetError ||
                    "选择父文件夹并输入新名称后显示完整路径。"}
                </span>
                {workspaceTarget?.exists && (
                  <small>
                    目标已存在且不会修改，请改名或使用右侧打开流程。
                  </small>
                )}
              </div>
              <button
                className="primary"
                data-testid="init-workspace"
                disabled={!workspaceTarget || workspaceTarget.exists}
                onClick={() => void initializeWorkspace()}
              >
                创建新工作区
              </button>
            </div>

            <div className="subpanel">
              <h3>打开已有工作区</h3>
              <p className="prerequisite">
                只打开已经初始化完成、结构有效的 AIGC-Proof 工作区。
              </p>
              <Field label="已有工作区文件夹">
                <div className="field-row">
                  <input
                    aria-label="已有工作区文件夹"
                    data-testid="open-workspace-path"
                    readOnly
                    placeholder="请选择已有工作区"
                    value={openWorkspacePath}
                  />
                  <button
                    className="secondary"
                    data-testid="choose-open-workspace"
                    onClick={() =>
                      void choose(
                        setOpenWorkspaceReference,
                        setOpenWorkspacePath,
                        () => proofHost.chooseExistingWorkspace(),
                      )
                    }
                  >
                    选择
                  </button>
                </div>
              </Field>
              <button
                className="secondary"
                data-testid="open-workspace"
                disabled={!openWorkspaceReference}
                onClick={() => void openWorkspace()}
              >
                打开所选工作区
              </button>
              <div className="current-context">
                <span>当前工作区</span>
                <strong>{workspacePath || "尚未创建或打开工作区"}</strong>
              </div>
            </div>
          </div>
        </section>

        <details
          className="panel advanced-panel"
          data-region="manual-proof-tools"
          style={{ order: 99 }}
        >
          <summary>
            <strong>高级：手工证明工具</strong>
            <span>
              用于导入/外部资产、自定义事件和手工工作区；集成 ComfyUI
              创作通常无需使用。
            </span>
          </summary>
          <div className="advanced-panel-body">
            <p className="assurance-inline">
              这里只是把文件复制、哈希并标记角色。选择 input
              仅表示输入素材，不会把图片证明为生成结果或证明作者身份。
            </p>
            <p className="prerequisite">
              {workspace
                ? `当前：${workspace.displayPath}`
                : "前置条件：请先创建或打开工作区。"}
            </p>
            <div className="asset-controls">
              <Field label="资产文件">
                <div className="field-row">
                  <input
                    data-testid="asset-path"
                    readOnly
                    placeholder="选择一个本地文件"
                    value={assetPath}
                  />
                  <button
                    className="secondary"
                    data-testid="choose-asset"
                    onClick={() =>
                      void choose(setAssetReference, setAssetPath, () =>
                        proofHost.chooseAsset(),
                      )
                    }
                  >
                    选择文件
                  </button>
                </div>
              </Field>
              <Field label="资产角色">
                <select
                  data-testid="asset-role"
                  value={assetRole}
                  onChange={(event) =>
                    setAssetRole(event.target.value as AssetRole)
                  }
                >
                  {roles.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                className="secondary compact-action"
                data-testid="add-asset"
                disabled={!workspace || !assetReference}
                onClick={() => void addAsset()}
              >
                添加到工作区
              </button>
            </div>
            <div className="asset-list" data-testid="asset-list">
              {(workspace?.workspace.assets ?? []).length === 0 && (
                <p>尚无资产。至少添加实际创作流程需要的输入与输出。</p>
              )}
              {(workspace?.workspace.assets ?? []).map((asset) => (
                <div className="asset-row" key={asset.asset_id}>
                  <span className={`role role-${asset.role}`}>
                    {asset.role}
                  </span>
                  <div>
                    <strong>{asset.original_name}</strong>
                    <small>
                      {formatBytes(asset.size_bytes)} ·{" "}
                      {asset.sha256.slice(0, 16)}…
                    </small>
                  </div>
                </div>
              ))}
            </div>
            <div className="advanced-tools-grid">
              <section className="subpanel" data-region="event">
                <h3>记录自定义创作事件</h3>
                <p className="prerequisite">
                  用于外部或手工流程，把 JSON
                  对象写入规范化事件哈希链；不是集成创作后的必做步骤。
                </p>
                <Field label="事件类型">
                  <input
                    data-testid="event-type"
                    value={eventType}
                    onChange={(event) => setEventType(event.target.value)}
                  />
                </Field>
                <Field label="JSON 载荷">
                  <textarea
                    data-testid="event-payload"
                    value={payloadJson}
                    onChange={(event) => setPayloadJson(event.target.value)}
                    rows={8}
                  />
                </Field>
                <button
                  className="secondary"
                  data-testid="record-event"
                  disabled={!workspace}
                  onClick={() => void recordEvent()}
                >
                  记录自定义事件
                </button>
              </section>

              <section className="subpanel" data-region="seal">
                <h3>手工封装证明包</h3>
                <p className="prerequisite">
                  用于已手工导入资产和事件的工作区；集成创作的主操作已经自动封装、验证并保存报告一次。
                </p>
                <Field label="输出 .aigcproof">
                  <div className="field-row">
                    <input
                      data-testid="seal-output"
                      readOnly
                      placeholder="选择新的输出文件"
                      value={sealOutput}
                    />
                    <button
                      className="secondary"
                      data-testid="choose-package-output"
                      onClick={() =>
                        void choose(setSealOutputReference, setSealOutput, () =>
                          proofHost.choosePackageOutput(),
                        )
                      }
                    >
                      选择位置
                    </button>
                  </div>
                </Field>
                <label className="confirmation-row">
                  <input
                    data-testid="confirm-seal-signature"
                    type="checkbox"
                    checked={confirmSealSignature}
                    onChange={(event) =>
                      setConfirmSealSignature(event.target.checked)
                    }
                  />
                  <span>
                    使用当前本地密钥签名；显示名称仅为自我声明，不证明真实姓名、权属、原创性或授权。
                  </span>
                </label>
                <button
                  className="secondary"
                  data-testid="seal-package"
                  disabled={
                    !workspace ||
                    !sealOutputReference ||
                    signerStatus?.state !== "active" ||
                    !confirmSealSignature
                  }
                  onClick={() => void sealPackage()}
                >
                  手工封装并自检
                </button>
              </section>
            </div>
          </div>
        </details>

        <section className="panel creation-panel" data-region="creation">
          <PanelTitle
            step="03"
            title="本地创作 → 自动证明"
            hint="固定核心节点工作流；生成输出由 Main 自动获取、校验和加入工作区，无需再次浏览文件"
          />
          <div className="creation-layout">
            <div className="creation-column">
              <h3>1. 核验本地 Provider</h3>
              <p className="prerequisite">
                仅连接 127.0.0.1:8188；不会下载、更新或打包
                ComfyUI、Python、模型或自定义节点。
              </p>
              <Field label="ComfyUI portable 安装目录">
                <div className="field-row">
                  <input
                    data-testid="provider-path"
                    readOnly
                    placeholder="选择包含 python_embeded 与 ComfyUI 的目录"
                    value={providerPath}
                  />
                  <button
                    className="secondary"
                    data-testid="choose-provider"
                    onClick={() =>
                      void choose(setProviderReference, setProviderPath, () =>
                        proofHost.chooseProviderInstallation(),
                      )
                    }
                  >
                    选择
                  </button>
                </div>
              </Field>
              <button
                className="secondary"
                data-testid="inspect-provider"
                disabled={!providerReference}
                onClick={() => void inspectProvider()}
              >
                检查版本、许可与能力
              </button>
              {provider && (
                <div className="provider-card" data-testid="provider-card">
                  <strong>ComfyUI {provider.detectedVersion} · 已兼容</strong>
                  <span>{provider.endpoint}</span>
                  <span>
                    GPL-3.0-only · {provider.checkpoints.length} 个 checkpoint ·
                    检测到 {provider.customNodeCount} 个非基线节点（不会调用）
                  </span>
                </div>
              )}

              <h3>2. 新建创作</h3>
              <Field label="会话标题">
                <input
                  data-testid="creation-title"
                  value={creationTitle}
                  onChange={(event) => setCreationTitle(event.target.value)}
                  maxLength={200}
                />
              </Field>
              <button
                className="primary"
                data-testid="create-creation-session"
                disabled={
                  !workspaceScopeReady || !provider || !creationTitle.trim()
                }
                onClick={() => void createSession()}
              >
                在当前工作区创建会话
              </button>
              <h4>恢复历史会话</h4>
              <p className="prerequisite">
                历史会话只显示当前工作区内容，默认不自动恢复缩略图或证明结果。
              </p>
              <div className="session-list" data-testid="creation-sessions">
                {creationSessions.length === 0 && (
                  <p>当前工作区暂无历史创作会话。</p>
                )}
                {creationSessions.slice(0, 12).map((session) => (
                  <button
                    className={
                      creationSession?.reference.id === session.reference.id
                        ? "selected"
                        : ""
                    }
                    key={session.reference.id}
                    onClick={() => restoreCreationSession(session)}
                  >
                    <strong>{session.title}</strong>
                    <span>
                      {session.state} · {session.updatedAt}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="creation-column creation-form">
              <h3>3. 冻结生成事实</h3>
              <div className="creation-form-grid">
                <Field label="Checkpoint 观察值">
                  <select
                    data-testid="creation-checkpoint"
                    value={creationCheckpoint}
                    onChange={(event) =>
                      setCreationCheckpoint(event.target.value)
                    }
                  >
                    {(provider?.checkpoints ?? []).map((checkpoint) => (
                      <option key={checkpoint} value={checkpoint}>
                        {checkpoint}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Seed">
                  <input
                    data-testid="creation-seed"
                    inputMode="numeric"
                    value={creationSeed}
                    onChange={(event) => setCreationSeed(event.target.value)}
                  />
                </Field>
                <Field label="宽度">
                  <input
                    data-testid="creation-width"
                    inputMode="numeric"
                    value={creationWidth}
                    onChange={(event) => setCreationWidth(event.target.value)}
                  />
                </Field>
                <Field label="高度">
                  <input
                    data-testid="creation-height"
                    inputMode="numeric"
                    value={creationHeight}
                    onChange={(event) => setCreationHeight(event.target.value)}
                  />
                </Field>
                <Field label="Steps">
                  <input
                    data-testid="creation-steps"
                    inputMode="numeric"
                    value={creationSteps}
                    onChange={(event) => setCreationSteps(event.target.value)}
                  />
                </Field>
                <Field label="CFG">
                  <input
                    data-testid="creation-cfg"
                    inputMode="decimal"
                    value={creationCfg}
                    onChange={(event) => setCreationCfg(event.target.value)}
                  />
                </Field>
                <Field label="Sampler">
                  <select
                    data-testid="creation-sampler"
                    value={creationSampler}
                    onChange={(event) =>
                      setCreationSampler(
                        event.target.value as
                          | "euler"
                          | "euler_ancestral"
                          | "dpmpp_2m",
                      )
                    }
                  >
                    <option value="euler">euler</option>
                    <option value="euler_ancestral">euler_ancestral</option>
                    <option value="dpmpp_2m">dpmpp_2m</option>
                  </select>
                </Field>
                <Field label="Scheduler">
                  <select
                    data-testid="creation-scheduler"
                    value={creationScheduler}
                    onChange={(event) =>
                      setCreationScheduler(
                        event.target.value as "normal" | "karras" | "simple",
                      )
                    }
                  >
                    <option value="normal">normal</option>
                    <option value="karras">karras</option>
                    <option value="simple">simple</option>
                  </select>
                </Field>
              </div>
              <Field label="Prompt">
                <textarea
                  data-testid="creation-prompt"
                  rows={4}
                  value={creationPrompt}
                  onChange={(event) => setCreationPrompt(event.target.value)}
                  maxLength={32768}
                />
              </Field>
              <Field label="Negative prompt">
                <textarea
                  data-testid="creation-negative-prompt"
                  rows={3}
                  value={creationNegativePrompt}
                  onChange={(event) =>
                    setCreationNegativePrompt(event.target.value)
                  }
                  maxLength={32768}
                />
              </Field>
              <Field label="Prompt 披露">
                <select
                  data-testid="creation-disclosure"
                  value={creationDisclosure}
                  onChange={(event) =>
                    setCreationDisclosure(
                      event.target.value as "included" | "digest-only",
                    )
                  }
                >
                  <option value="included">随证据包含原文</option>
                  <option value="digest-only">仅包含 SHA-256</option>
                </select>
                <small className="field-help">
                  digest-only
                  原文只在本次运行内存中使用，重启后不会保留，也无法继续未运行的冻结会话。
                </small>
              </Field>
              <div className="actions">
                <button
                  className="primary"
                  data-testid="freeze-creation-session"
                  disabled={
                    creationSession?.state !== "draft" ||
                    !creationCheckpoint ||
                    !creationPrompt
                  }
                  onClick={() => void freezeSession()}
                >
                  冻结快照
                </button>
                <button
                  className="primary"
                  data-testid="run-creation-session"
                  disabled={
                    !creationSession ||
                    !["frozen", "failed", "cancelled"].includes(
                      creationSession.state,
                    )
                  }
                  onClick={() => void runSession()}
                >
                  运行真实 ComfyUI
                </button>
                <button
                  className="quiet-button"
                  data-testid="cancel-creation-session"
                  disabled={creationSession?.state !== "running"}
                  onClick={() => void cancelSession()}
                >
                  取消
                </button>
              </div>
            </div>
          </div>

          {creationSession && (
            <div className="creation-review" data-testid="creation-review">
              <div>
                <strong>{creationSession.title}</strong>
                <span data-testid="creation-state">
                  {creationSession.state}
                </span>
              </div>
              <div className="progress-track">
                <i
                  style={{
                    width: `${creationSession.progress?.completedUnits ?? 0}%`,
                  }}
                />
              </div>
              <p>{creationSession.progress?.message ?? "等待创作快照。"}</p>
              {creationSession.snapshot && (
                <code>
                  snapshot {creationSession.snapshot.snapshot_sha256}\n prompt{" "}
                  {creationSession.snapshot.prompt_disclosure} ·{" "}
                  {creationSession.snapshot.prompt_sha256}\n template{" "}
                  {creationSession.snapshot.workflow_template_sha256}
                </code>
              )}
              {creationSession.output && (
                <div
                  className="creation-output-card"
                  data-testid="creation-output"
                >
                  {creationSession.output.previewDataUrl && (
                    <img
                      src={creationSession.output.previewDataUrl}
                      alt={`生成图片：${creationSession.output.asset.original_name}`}
                    />
                  )}
                  <div>
                    <strong>
                      {creationSession.output.asset.original_name}
                    </strong>
                    <span>
                      {formatBytes(creationSession.output.sizeBytes)} · 已作为
                      output 自动加入证明工作区
                    </span>
                    <code>{creationSession.output.sha256}</code>
                    {creationSession.verification && (
                      <span>
                        证明 ID：
                        {creationSession.verification.proof_id ?? "无"} · 包：
                        {creationSession.packageDisplayPath ?? "尚未封装"}
                      </span>
                    )}
                    <button
                      className="primary"
                      data-testid="export-creation-output"
                      onClick={() => void exportCreationOutput()}
                    >
                      保存生成图片副本
                    </button>
                  </div>
                </div>
              )}
              {creationSession.error && (
                <p className="error-line">
                  [{creationSession.error.code}] {creationSession.error.message}
                </p>
              )}
              <small>
                Provider、模型与本机观察时间均为观察值；不代表身份、权属、原创性、授权、数字签名或
                RFC 3161 可信时间。
              </small>
            </div>
          )}

          <div className="creation-complete">
            <h3>4. 封装、立即验证并保存报告</h3>
            <Field label="新的 .aigcproof 输出">
              <div className="field-row">
                <input
                  readOnly
                  data-testid="creation-package-path"
                  value={creationPackagePath}
                />
                <button
                  className="secondary"
                  data-testid="choose-creation-package-output"
                  onClick={() =>
                    void choose(
                      setCreationPackageOutput,
                      setCreationPackagePath,
                      () => proofHost.choosePackageOutput(),
                    )
                  }
                >
                  选择位置
                </button>
              </div>
            </Field>
            <Field label="新的 JSON 验证报告">
              <div className="field-row">
                <input
                  readOnly
                  data-testid="creation-report-path"
                  value={creationReportPath}
                />
                <button
                  className="secondary"
                  data-testid="choose-creation-report-output"
                  onClick={() =>
                    void choose(
                      setCreationReportOutput,
                      setCreationReportPath,
                      () => proofHost.chooseReportOutput(),
                    )
                  }
                >
                  选择位置
                </button>
              </div>
            </Field>
            <label className="confirmation-row">
              <input
                data-testid="confirm-creation-signature"
                type="checkbox"
                checked={confirmCreationSignature}
                onChange={(event) =>
                  setConfirmCreationSignature(event.target.checked)
                }
              />
              <span>
                确认用当前本地密钥签署此创作证明；该身份是自我声明，不构成实名、原创性、版权或授权认证。
              </span>
            </label>
            <button
              className="primary"
              data-testid="complete-creation-proof"
              disabled={
                creationSession?.state !== "proof_ready" ||
                !creationPackageOutput ||
                !creationReportOutput ||
                signerStatus?.state !== "active" ||
                !confirmCreationSignature
              }
              onClick={() => void completeCreationProof()}
            >
              封装 → 验证 → 保存报告
            </button>
            {creationSession?.state === "complete" &&
              creationSession.verification && (
                <VerificationCard report={creationSession.verification} />
              )}
          </div>
        </section>

        <section className="panel" data-region="verify">
          <PanelTitle
            title="验证已有证明包"
            hint="独立验证、元数据检查和报告保存工具；不是集成创作后的下一步骤"
          />
          <Field label="证明包">
            <div className="field-row">
              <input
                data-testid="package-path"
                readOnly
                placeholder="选择 .aigcproof"
                value={packagePath}
              />
              <button
                className="secondary"
                data-testid="choose-package"
                onClick={() => void choosePackageForVerification()}
              >
                选择文件
              </button>
            </div>
          </Field>
          <div className="subpanel" data-testid="trusted-time-panel">
            <strong>RFC 3161 可信时间</strong>
            <p>
              日常验证保持离线；只有点击“请求可信时间”并确认披露后，才会连接已导入配置中的
              HTTPS 端点。
            </p>
            <Field label="显式 TSA 信任快照">
              <div className="field-row">
                <input
                  data-testid="tsa-profile-path"
                  readOnly
                  value={tsaProfilePath || tsaProfile?.source_label || ""}
                  placeholder="导入可移植 TSA 信任快照"
                />
                <button
                  className="secondary"
                  data-testid="import-tsa-profile"
                  onClick={() => void importTsaProfile()}
                >
                  导入配置
                </button>
              </div>
            </Field>
            {tsaProfile && (
              <small data-testid="tsa-profile-summary">
                {tsaProfile.source_label} · {tsaProfile.endpoint} · 有效期至{" "}
                {tsaProfile.expires_at}
              </small>
            )}
            <Field label="带时间戳的新证明包">
              <div className="field-row">
                <input
                  data-testid="timestamp-output-path"
                  readOnly
                  value={timestampOutputPath}
                  placeholder="选择新的 .aigcproof 输出"
                />
                <button
                  className="secondary"
                  data-testid="choose-timestamp-output"
                  onClick={() =>
                    void choose(
                      setTimestampOutputReference,
                      setTimestampOutputPath,
                      () => proofHost.chooseTimestampPackageOutput(),
                    )
                  }
                >
                  选择输出
                </button>
              </div>
            </Field>
            <div className="actions">
              <button
                className="primary"
                data-testid="request-trusted-time"
                disabled={
                  !tsaProfile || !packageReference || !timestampOutputReference
                }
                onClick={() => void requestTrustedTimestamp()}
              >
                请求可信时间
              </button>
              <button
                className="secondary"
                data-testid="cancel-trusted-time"
                onClick={() => void proofHost.cancelTrustedTimestamp()}
              >
                取消请求
              </button>
            </div>
          </div>
          <div className="subpanel" data-testid="c2pa-panel">
            <strong>C2PA 2.2 / Content Credentials（离线桥接）</strong>
            <p>
              仅读取 JPEG、PNG、WebP 内嵌清单或你明确选择的本地 .c2pa
              sidecar；不会联网查找远程清单或软绑定。
              有效性是来源元数据，不代表内容真实、身份、原创、权利或授权。
            </p>
            <Field label="C2PA 信任配置">
              <div className="field-row">
                <input
                  data-testid="c2pa-profile-path"
                  readOnly
                  value={c2paProfilePath || c2paProfile?.signerSource || ""}
                  placeholder="导入独立的签名者与 TSA 信任快照"
                />
                <button
                  className="secondary"
                  data-testid="import-c2pa-profile"
                  onClick={() => void importC2paProfile()}
                >
                  导入配置
                </button>
              </div>
            </Field>
            {c2paProfile && (
              <small data-testid="c2pa-profile-summary">
                签名者：{c2paProfile.signerSource} · TSA：
                {c2paProfile.timestampSource}
              </small>
            )}
            <Field label="待检查图片">
              <div className="field-row">
                <input
                  data-testid="c2pa-image-path"
                  readOnly
                  value={c2paImagePath}
                  placeholder="选择 JPEG、PNG 或 WebP"
                />
                <button
                  className="secondary"
                  data-testid="choose-c2pa-image"
                  onClick={() => void chooseC2paImage()}
                >
                  选择图片
                </button>
              </div>
            </Field>
            <Field label="本地 sidecar（可选）">
              <div className="field-row">
                <input
                  data-testid="c2pa-sidecar-path"
                  readOnly
                  value={c2paSidecarPath}
                  placeholder="不选择时仅读取内嵌清单"
                />
                <button
                  className="secondary"
                  data-testid="choose-c2pa-sidecar"
                  onClick={() => void chooseC2paSidecar()}
                >
                  选择 .c2pa
                </button>
                {c2paSidecar && (
                  <button
                    className="quiet-button"
                    data-testid="clear-c2pa-sidecar"
                    onClick={() => {
                      setC2paSidecar(undefined);
                      setC2paSidecarPath("");
                      setC2paInspection(undefined);
                    }}
                  >
                    使用内嵌清单
                  </button>
                )}
              </div>
            </Field>
            <div className="actions">
              <button
                className="primary"
                data-testid="inspect-c2pa"
                disabled={!c2paProfile || !c2paImage}
                onClick={() => void inspectC2pa()}
              >
                离线检查 Content Credentials
              </button>
            </div>
            {c2paInspection && (
              <div className="signature-evidence" data-testid="c2pa-inspection">
                <strong>{c2paInspection.validation_state}</strong>
                <span>claim v{c2paInspection.claim_version}</span>
                <span>来源：{c2paInspection.source_mode}</span>
                <span>签名者信任：{c2paInspection.signer_trust}</span>
                <span>时间戳信任：{c2paInspection.timestamp_trust}</span>
                <code>{c2paInspection.asset_sha256}</code>
              </div>
            )}
            <Field label="记录到当前工作区资产（可选）">
              <select
                data-testid="c2pa-workspace-asset"
                value={c2paAssetId}
                onChange={(event) => setC2paAssetId(event.target.value)}
              >
                <option value="">选择已接入的图片资产</option>
                {(workspace?.workspace.assets ?? [])
                  .filter((asset) =>
                    ["image/jpeg", "image/png", "image/webp"].includes(
                      asset.media_type,
                    ),
                  )
                  .map((asset) => (
                    <option key={asset.asset_id} value={asset.asset_id}>
                      {asset.original_name} · {asset.role}
                    </option>
                  ))}
              </select>
            </Field>
            <button
              className="secondary"
              data-testid="create-c2pa-observation"
              disabled={!c2paProfile || !workspace || !c2paAssetId}
              onClick={() => void createC2paObservation()}
            >
              创建摘要绑定的 C2PA 观察记录
            </button>
          </div>
          <div className="actions">
            <button
              className="primary"
              data-testid="verify-package"
              disabled={!packageReference}
              onClick={() => void verifyPackage()}
            >
              验证包内完整性
            </button>
            <button
              className="secondary"
              data-testid="inspect-package"
              disabled={!packageReference}
              onClick={() => void inspectPackage()}
            >
              仅检查元数据
            </button>
          </div>
          {report && <VerificationCard report={report} />}
          {inspection && (
            <div className="warning-card" data-testid="inspection-card">
              <strong>未执行完整性验证</strong>
              <span>证明 ID：{inspection.proof_id}</span>
              <span>
                资产 {inspection.assets.length} · 事件{" "}
                {inspection.event_chain.event_count}
              </span>
              {inspection.creator_signature && (
                <>
                  <span>
                    声明的创建者：{inspection.creator_signature.display_label}
                  </span>
                  <span>
                    声明的密钥指纹：
                    {inspection.creator_signature.key_fingerprint}
                  </span>
                  <small>
                    以上字段尚未验证，不能作为身份或签名有效性结论。
                  </small>
                </>
              )}
            </div>
          )}
          <Field label="验证报告保存位置">
            <div className="field-row">
              <input
                data-testid="report-path"
                readOnly
                placeholder="验证后选择新的 JSON 文件"
                value={reportPath}
              />
              <button
                className="secondary"
                data-testid="choose-report-output"
                onClick={() =>
                  void choose(setReportOutputReference, setReportPath, () =>
                    proofHost.chooseReportOutput(),
                  )
                }
              >
                选择位置
              </button>
            </div>
          </Field>
          <button
            className="secondary"
            data-testid="save-report"
            disabled={!report || !reportOutputReference}
            onClick={() => void saveReport()}
          >
            保存最近验证报告
          </button>
        </section>

        <section className="panel" data-region="jobs" data-testid="jobs-panel">
          <PanelTitle
            title="任务、进度与取消"
            hint="排队任务可立即取消；运行中的 Rust 原子阶段只记录取消请求并安全结束"
          />
          <div className="jobs-list">
            {jobs.length === 0 && (
              <p>尚无任务。以上证明操作会自动进入有界队列。</p>
            )}
            {jobs.slice(0, 20).map((job) => (
              <article
                className={`job-row state-${job.state}`}
                key={job.reference.id}
                data-job-state={job.state}
              >
                <div className="job-heading">
                  <strong>{job.operation}</strong>
                  <span>{jobStateLabels[job.state]}</span>
                </div>
                <div
                  className="progress-track"
                  aria-label={`${job.operation} 进度 ${job.progress.completedUnits}%`}
                >
                  <i style={{ width: `${job.progress.completedUnits}%` }} />
                </div>
                <p>
                  {job.progress.phase} · {job.progress.message}
                </p>
                {job.error && (
                  <code>
                    [{job.error.code}] {job.error.message}
                  </code>
                )}
                {(job.state === "queued" || job.state === "running") && (
                  <button
                    className="quiet-button"
                    onClick={() =>
                      void proofHost.cancelJob({ job: job.reference })
                    }
                  >
                    {job.state === "queued" ? "取消排队任务" : "请求取消"}
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="panel" data-region="settings">
          <PanelTitle
            title="本地设置与运行诊断"
            hint="SQLite 可删除重建，不是证明格式或证据"
          />
          <div className="settings-grid">
            <div className="subpanel">
              <Field label="主题">
                <select
                  data-testid="theme-setting"
                  value={state?.preferences.theme ?? "light"}
                  onChange={(event) => {
                    document.documentElement.dataset.theme = event.target.value;
                    void proofHost
                      .setPreference({
                        key: "theme",
                        value: event.target.value,
                      })
                      .then(
                        (response) => response.ok && setState(response.data),
                      );
                  }}
                >
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </select>
              </Field>
              <button
                className="secondary"
                data-testid="rebuild-recents"
                onClick={() =>
                  void run("正在重建最近项索引", async () => {
                    const response = await proofHost.rebuildRecents();
                    if (!response.ok) return showFailure(response);
                    setState(response.data);
                    showSuccess("最近项索引已从可携带文件重建", response.data);
                  })
                }
              >
                重建最近项索引
              </button>
              <p className="privacy-note">
                删除或损坏工作台数据库不会改变任何工作区、证明包或验证报告的有效性。
              </p>
            </div>
            <div className="subpanel signer-card" data-testid="signer-card">
              <h3>本地签名身份</h3>
              <p className="privacy-note">
                私钥只保存在操作系统凭据库中，不会写入工作区或证明包。显示名称是自我声明，不代表实名、所有权、原创性或授权。
              </p>
              <Field label="显示名称">
                <input
                  data-testid="signer-display-label"
                  value={signerLabel}
                  disabled={
                    signerStatus?.state === "disabled" ||
                    signerStatus?.state === "unavailable"
                  }
                  maxLength={200}
                  onChange={(event) => setSignerLabel(event.target.value)}
                />
              </Field>
              <dl className="signer-status">
                <div>
                  <dt>状态</dt>
                  <dd data-testid="signer-state">
                    {signerStatus?.state ?? "loading"}
                  </dd>
                </div>
                {signerStatus?.key_fingerprint && (
                  <div>
                    <dt>SHA-256 指纹</dt>
                    <dd>
                      <input
                        ref={signerFingerprintRef}
                        className="fingerprint-field"
                        data-testid="signer-fingerprint"
                        readOnly
                        value={signerStatus.key_fingerprint}
                      />
                      <button
                        className="quiet-button"
                        data-testid="copy-signer-fingerprint"
                        onClick={copySignerFingerprint}
                      >
                        复制完整指纹
                      </button>
                    </dd>
                  </div>
                )}
              </dl>
              {signerStatus?.warning_codes.map((code) => (
                <p className="warning-line" key={code}>
                  {code}
                </p>
              ))}
              <div className="actions">
                {signerStatus?.state === "missing" && (
                  <button
                    className="primary"
                    data-testid="create-signer"
                    disabled={!signerLabel.trim()}
                    onClick={() => void createSigner()}
                  >
                    创建本地身份
                  </button>
                )}
                {signerStatus?.state === "active" && (
                  <>
                    <button
                      className="secondary"
                      data-testid="rotate-signer"
                      disabled={!signerLabel.trim()}
                      onClick={() => void rotateSigner()}
                    >
                      轮换密钥
                    </button>
                    <button
                      className="quiet-button"
                      data-testid="disable-signer"
                      onClick={() => void disableSigner()}
                    >
                      永久禁用并删除私钥
                    </button>
                  </>
                )}
              </div>
              {signerStatus?.state === "disabled" && (
                <p className="warning-line">本地私钥已删除，签名功能已禁用。</p>
              )}
              {signerStatus?.state === "unavailable" && (
                <p className="warning-line">
                  操作系统凭据库当前不可用；为避免私钥降级存储，签名功能保持关闭。
                </p>
              )}
            </div>
            {diagnostics && <DiagnosticsCard diagnostics={diagnostics} />}
          </div>
        </section>
      </main>
    </div>
  );
}

function PanelTitle({
  step,
  title,
  hint,
}: {
  step?: string;
  title: string;
  hint: string;
}) {
  return (
    <div className={`panel-title ${step ? "" : "no-step"}`}>
      {step && <span>{step}</span>}
      <div>
        <h2>{title}</h2>
        <p>{hint}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function RecentList({
  title,
  testId,
  items,
  onSelect,
}: {
  title: string;
  testId: string;
  items: Array<
    | WorkbenchState["recentWorkspaces"][number]
    | WorkbenchState["recentPackages"][number]
  >;
  onSelect: (reference: HostReference, displayPath: string) => void;
}) {
  return (
    <div className="recent-card" data-testid={testId}>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p>暂无记录</p>
      ) : (
        items.map((item) => (
          <button
            key={item.reference.id}
            onClick={() => onSelect(item.reference, item.displayPath)}
            title={item.displayPath}
          >
            {item.displayPath}
          </button>
        ))
      )}
    </div>
  );
}

function DiagnosticsCard({ diagnostics }: { diagnostics: HostDiagnostics }) {
  return (
    <div className="diagnostics-card" data-testid="diagnostics-card">
      <h3>版本、Utility 与能力</h3>
      <dl>
        <div>
          <dt>Workbench</dt>
          <dd>{diagnostics.workbenchVersion}</dd>
        </div>
        <div>
          <dt>Host / Native API</dt>
          <dd>
            {diagnostics.contractVersion} / {diagnostics.nativeApiVersion}
          </dd>
        </div>
        <div>
          <dt>Engine / Protocol</dt>
          <dd>
            {diagnostics.engineVersion} / {diagnostics.protocolVersion}
          </dd>
        </div>
        <div>
          <dt>Utility</dt>
          <dd data-testid="utility-health">
            {diagnostics.utility.state} · generation{" "}
            {diagnostics.utility.generation}
            {diagnostics.utility.processId
              ? ` · PID ${diagnostics.utility.processId}`
              : ""}
          </dd>
        </div>
        <div>
          <dt>队列限制</dt>
          <dd>
            并发 {diagnostics.limits.maxConcurrentJobs} · 排队{" "}
            {diagnostics.limits.maxQueuedJobs} · 超时{" "}
            {Math.round(diagnostics.limits.operationTimeoutMs / 1000)} 秒
          </dd>
        </div>
      </dl>
      <strong>已实现能力</strong>
      <code data-testid="implemented-capabilities">
        {diagnostics.capabilities.join("\n")}
      </code>
      <strong>明确不可用</strong>
      <code data-testid="unavailable-features">
        {diagnostics.unavailableFeatures.join("\n")}
      </code>
      <small>
        这些是本地运行诊断，不是认证、身份、签名、可信时间或官方验证。
      </small>
    </div>
  );
}

function VerificationCard({ report }: { report: VerificationReport }) {
  return (
    <div
      className={`verification-card status-${report.status}`}
      data-testid="verification-card"
    >
      <div>
        <strong>
          {report.status === "valid"
            ? "证明包验证有效"
            : report.status === "invalid"
              ? "证明包验证无效"
              : "验证操作错误"}
        </strong>
        <span>{report.proof_id ?? "无可用证明 ID"}</span>
      </div>
      <dl className="verification-assurance" data-testid="signature-assurance">
        <div>
          <dt>内部完整性</dt>
          <dd>{report.assurance.internal_integrity}</dd>
        </div>
        <div>
          <dt>创建者身份</dt>
          <dd>{report.assurance.creator_identity}</dd>
        </div>
        <div>
          <dt>数字签名</dt>
          <dd>{report.assurance.digital_signature}</dd>
        </div>
        <div>
          <dt>可信时间</dt>
          <dd>{report.assurance.trusted_time}</dd>
        </div>
      </dl>
      {report.creator_signature && (
        <div className="signature-evidence" data-testid="signature-evidence">
          <strong>{report.creator_signature.display_label}</strong>
          <code>{report.creator_signature.key_fingerprint}</code>
          <span>{report.creator_signature.profile}</span>
          <span>本地信任：{report.creator_signature.local_trust}</span>
          <small>
            显示名称是签名者自我声明；有效签名不证明实名、原创性、版权、权属或授权。
          </small>
        </div>
      )}
      {report.trusted_time && (
        <div className="signature-evidence" data-testid="trusted-time-evidence">
          <strong>{report.trusted_time.source_label ?? "RFC 3161 TSA"}</strong>
          <code>{report.trusted_time.timestamp_path}</code>
          <span>生成时间：{report.trusted_time.gen_time ?? "不可用"}</span>
          <span>
            策略：
            {report.trusted_time.granted_policy ??
              report.trusted_time.requested_policy}
          </span>
          <span>吊销证据：{report.trusted_time.revocation}</span>
          <small>
            可信时间仅证明时间戳机构在该时刻签署了包内签名字节摘要；不证明实名、原创性、版权、权属或授权。
          </small>
        </div>
      )}
      {report.c2pa && (
        <div className="signature-evidence" data-testid="c2pa-evidence">
          <strong>C2PA：{report.c2pa.state}</strong>
          <span>观察记录：{report.c2pa.observations.length}</span>
          <small>
            C2PA
            仅表达媒体来源元数据及其验证状态；不证明事实真实、人员身份、原创性、所有权、版权或授权。
          </small>
        </div>
      )}
      <ul>
        {report.checks.map((check) => (
          <li key={`${check.code}-${check.path ?? ""}`}>
            <span>{check.status}</span>
            <strong>{check.code}</strong>
            {check.message}
          </li>
        ))}
      </ul>
      {report.errors.map((error) => (
        <p className="error-line" key={`${error.code}-${error.path ?? ""}`}>
          [{error.code}] {error.message}
        </p>
      ))}
      {report.warnings.map((warning) => (
        <p className="warning-line" key={warning.code}>
          [{warning.code}] {warning.message}
        </p>
      ))}
    </div>
  );
}
