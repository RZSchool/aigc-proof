import { useEffect, useMemo, useState } from "react";

import type {
  AssetRole,
  BridgeEnvelope,
  Inspection,
  VerificationReport,
  WorkbenchState,
  WorkspaceSummary,
  WorkspaceTargetPreview,
} from "../shared/contracts";

type Section = "home" | "workspace" | "event" | "seal" | "verify" | "settings";

const sections: Array<{ id: Section; label: string; step: string }> = [
  { id: "home", label: "总览", step: "01" },
  { id: "workspace", label: "工作区与资产", step: "02" },
  { id: "event", label: "创作事件", step: "03" },
  { id: "seal", label: "封装证明包", step: "04" },
  { id: "verify", label: "验证与检查", step: "05" },
  { id: "settings", label: "设置", step: "06" },
];

const roles: Array<{ value: AssetRole; label: string }> = [
  { value: "input", label: "输入 input" },
  { value: "output", label: "输出 output" },
  { value: "reference", label: "参考 reference" },
  { value: "license", label: "许可 license" },
  { value: "other", label: "其他 other" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function errorGuidance(code: string, fallback: string): string {
  switch (code) {
    case "WORKSPACE_ALREADY_EXISTS":
      return "目标文件夹已存在，未进行任何修改。若它是有效工作区，请使用“打开已有工作区”；否则请选择其他名称。";
    case "WORKSPACE_FOLDER_NAME_INVALID":
    case "IPC_REQUEST_INVALID":
      return "请输入一个新的可移植文件夹名，不能包含分隔符、保留设备名或尾随点/空格。";
    case "INVALID_WORKSPACE":
    case "WORKSPACE_JSON_MALFORMED":
    case "WORKSPACE_SCHEMA_INVALID":
      return "所选文件夹不是有效的 AIGC-Proof 工作区。请选择包含完整工作区文件的目录。";
    default:
      return fallback;
  }
}

export function App() {
  const [section, setSection] = useState<Section>("home");
  const [busy, setBusy] = useState<string>();
  const [result, setResult] = useState(
    "工作台已就绪。所有证明操作均在本机离线执行。",
  );
  const [resultKind, setResultKind] = useState<"idle" | "success" | "error">(
    "idle",
  );
  const [state, setState] = useState<WorkbenchState>();
  const [workspacePath, setWorkspacePath] = useState("");
  const [createParent, setCreateParent] = useState("");
  const [workspaceFolderName, setWorkspaceFolderName] = useState("");
  const [workspaceTarget, setWorkspaceTarget] =
    useState<WorkspaceTargetPreview>();
  const [workspaceTargetError, setWorkspaceTargetError] = useState("");
  const [openWorkspacePath, setOpenWorkspacePath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceSummary>();
  const [assetPath, setAssetPath] = useState("");
  const [assetRole, setAssetRole] = useState<AssetRole>("input");
  const [eventType, setEventType] = useState("generation");
  const [payloadJson, setPayloadJson] = useState(
    '{\n  "model": "local-model"\n}',
  );
  const [sealOutput, setSealOutput] = useState("");
  const [packagePath, setPackagePath] = useState("");
  const [reportPath, setReportPath] = useState("");
  const [report, setReport] = useState<VerificationReport>();
  const [inspection, setInspection] = useState<Inspection>();

  const currentSection = useMemo(
    () => sections.find((item) => item.id === section) ?? sections[0]!,
    [section],
  );

  useEffect(() => {
    void window.aigcProof.getState().then((response) => {
      if (response.ok) {
        setState(response.data);
        const saved = response.data.preferences.lastSection as
          | Section
          | undefined;
        if (saved && sections.some((item) => item.id === saved))
          setSection(saved);
        document.documentElement.dataset.theme =
          response.data.preferences.theme ?? "light";
      } else {
        setResultKind("error");
        setResult(
          `[${response.error.code}] ${errorGuidance(response.error.code, response.error.message)}`,
        );
      }
    });
  }, []);

  useEffect(() => {
    let active = true;
    if (!createParent || !workspaceFolderName) {
      setWorkspaceTarget(undefined);
      setWorkspaceTargetError("");
      return () => {
        active = false;
      };
    }
    void window.aigcProof
      .previewWorkspaceTarget({
        parent: createParent,
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
  }, [createParent, workspaceFolderName]);

  function showFailure<T>(response: BridgeEnvelope<T>): void {
    if (!response.ok) {
      setResultKind("error");
      setResult(
        `[${response.error.code}] ${errorGuidance(response.error.code, response.error.message)}${response.error.path ? `\n${response.error.path}` : ""}`,
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
    if (busy) return;
    setBusy(label);
    setResultKind("idle");
    setResult(`${label}…`);
    try {
      await operation();
      const refreshed = await window.aigcProof.getState();
      if (refreshed.ok) setState(refreshed.data);
    } catch (error) {
      setResultKind("error");
      setResult(error instanceof Error ? error.message : "操作失败。");
    } finally {
      setBusy(undefined);
    }
  }

  async function choose(
    setter: (value: string) => void,
    picker: () => Promise<string | null>,
  ) {
    const selected = await picker();
    if (selected) setter(selected);
  }

  async function initializeWorkspace(): Promise<void> {
    await run("正在初始化工作区", async () => {
      const response = await window.aigcProof.initializeWorkspace({
        parent: createParent,
        folderName: workspaceFolderName,
        ...(projectName.trim() ? { projectName: projectName.trim() } : {}),
      });
      if (!response.ok) return showFailure(response);
      setWorkspace(response.data);
      setWorkspacePath(response.data.path);
      setOpenWorkspacePath(response.data.path);
      showSuccess("工作区已创建", response.data);
    });
  }

  async function openWorkspace(path = openWorkspacePath): Promise<void> {
    await run("正在打开工作区", async () => {
      const response = await window.aigcProof.loadWorkspace({ path });
      if (!response.ok) return showFailure(response);
      setWorkspace(response.data);
      setWorkspacePath(response.data.path);
      setOpenWorkspacePath(response.data.path);
      showSuccess("工作区已打开", response.data);
    });
  }

  async function addAsset(): Promise<void> {
    await run("正在流式复制并计算 SHA-256", async () => {
      const response = await window.aigcProof.addAsset({
        workspace: workspacePath,
        source: assetPath,
        role: assetRole,
      });
      if (!response.ok) return showFailure(response);
      setWorkspace((current) =>
        current ? { ...current, workspace: response.data.workspace } : current,
      );
      showSuccess("资产已添加", response.data.asset);
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
      const response = await window.aigcProof.recordEvent({
        workspace: workspacePath,
        eventType,
        payloadJson,
      });
      if (!response.ok) return showFailure(response);
      showSuccess("事件已写入哈希链", response.data.event);
    });
  }

  async function sealPackage(): Promise<void> {
    await run("正在封装并自检证明包", async () => {
      const response = await window.aigcProof.sealPackage({
        workspace: workspacePath,
        output: sealOutput,
      });
      if (!response.ok) return showFailure(response);
      setPackagePath(response.data.path);
      showSuccess("证明包已封装（禁止覆盖）", response.data);
    });
  }

  async function verifyPackage(): Promise<void> {
    await run("正在验证包内完整性", async () => {
      const response = await window.aigcProof.verifyPackage({
        path: packagePath,
      });
      if (!response.ok) return showFailure(response);
      setReport(response.data);
      setInspection(undefined);
      showSuccess(`验证完成：${response.data.status}`, response.data);
    });
  }

  async function inspectPackage(): Promise<void> {
    await run("正在读取元数据（不执行验证）", async () => {
      const response = await window.aigcProof.inspectPackage({
        path: packagePath,
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
      const response = await window.aigcProof.saveReport({
        path: reportPath,
        report,
      });
      if (!response.ok) return showFailure(response);
      showSuccess("验证报告已保存（禁止覆盖）", response.data.path);
    });
  }

  async function navigate(next: Section): Promise<void> {
    setSection(next);
    const response = await window.aigcProof.setPreference({
      key: "lastSection",
      value: next,
    });
    if (response.ok) setState(response.data);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-mark">AP</div>
        <div className="brand-copy">
          <strong>AIGC-Proof</strong>
          <span data-testid="workbench-version">Workbench 0.1.1</span>
        </div>
        <nav aria-label="工作台区域">
          {sections.map((item) => (
            <button
              className={section === item.id ? "nav-item active" : "nav-item"}
              data-testid={`nav-${item.id}`}
              key={item.id}
              onClick={() => void navigate(item.id)}
            >
              <span>{item.step}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <button
          className="quiet-button exit"
          onClick={() => void window.aigcProof.closeApp()}
        >
          退出工作台
        </button>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">{currentSection.step} / LOCAL WORKBENCH</p>
            <h1>{currentSection.label}</h1>
          </div>
          <div className="offline-badge">
            <span /> 离线模式
          </div>
        </header>

        <section className="assurance-banner" data-testid="assurance-banner">
          <strong>能力边界：仅验证证明包内部完整性</strong>
          <span>
            创建者身份未验证 · 数字签名不存在 · 可信时间不存在 · 原创性未评估
          </span>
          <small>不是版权登记、公证、权属证明、原创认证或官方验证。</small>
        </section>

        <div className="content-grid">
          <div className="workspace-content">
            {section === "home" && (
              <section className="panel hero-panel">
                <p className="eyebrow">PROTOCOL 0.2.0</p>
                <h2>把创作过程整理成可离线验证的证明包</h2>
                <p>
                  工作台通过受限 IPC 调用 Rust
                  引擎。工作区与证明包是可携带文件；SQLite
                  只保存本机偏好和最近项。
                </p>
                <div className="quick-actions">
                  <button
                    className="primary"
                    onClick={() => void navigate("workspace")}
                  >
                    开始创建
                  </button>
                  <button
                    className="secondary"
                    onClick={() => void navigate("verify")}
                  >
                    验证已有包
                  </button>
                </div>
                <div className="recent-grid">
                  <RecentList
                    title="最近工作区"
                    testId="recent-workspaces"
                    items={state?.recentWorkspaces ?? []}
                    onSelect={(path) => {
                      void navigate("workspace");
                      void openWorkspace(path);
                    }}
                  />
                  <RecentList
                    title="最近证明包"
                    testId="recent-packages"
                    items={state?.recentPackages ?? []}
                    onSelect={(path) => {
                      setPackagePath(path);
                      void navigate("verify");
                    }}
                  />
                </div>
              </section>
            )}

            {section === "workspace" && (
              <>
                <section className="panel">
                  <PanelTitle
                    step="1"
                    title="新建工作区"
                    hint="先选择已有父文件夹，再为新工作区命名"
                  />
                  <Field label="父文件夹">
                    <div className="field-row">
                      <input
                        aria-label="新工作区父文件夹"
                        data-testid="create-parent"
                        readOnly
                        placeholder="请选择一个已存在的父文件夹"
                        value={createParent}
                        onChange={(e) => setCreateParent(e.target.value)}
                      />
                      <button
                        className="secondary"
                        data-testid="choose-create-parent"
                        onClick={() =>
                          void choose(
                            setCreateParent,
                            window.aigcProof.chooseWorkspaceParent,
                          )
                        }
                      >
                        选择父文件夹
                      </button>
                    </div>
                  </Field>
                  <Field label="新工作区文件夹名">
                    <input
                      aria-describedby="workspace-name-help"
                      data-testid="workspace-folder-name"
                      placeholder="例如：test 或 项目 工作区"
                      value={workspaceFolderName}
                      onChange={(e) => setWorkspaceFolderName(e.target.value)}
                      maxLength={120}
                    />
                    <small className="field-help" id="workspace-name-help">
                      只能填写一个文件夹名，不能包含
                      /、\、保留设备名或尾随点/空格。
                    </small>
                  </Field>
                  <Field label="项目名（可选）">
                    <input
                      data-testid="project-name"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      maxLength={200}
                    />
                  </Field>
                  <div
                    className={`target-preview ${workspaceTarget?.exists ? "target-exists" : ""}`}
                    data-testid="workspace-target-preview"
                  >
                    <strong>将创建到</strong>
                    <span>
                      {workspaceTarget?.path ||
                        workspaceTargetError ||
                        "选择父文件夹并输入新名称后显示完整路径。"}
                    </span>
                    {workspaceTarget?.exists && (
                      <small>
                        目标已存在，不会被修改。若它是有效工作区，请使用下方“打开已有工作区”；否则请选择其他名称。
                      </small>
                    )}
                  </div>
                  <button
                    className="primary"
                    data-testid="init-workspace"
                    disabled={
                      !!busy || !workspaceTarget || workspaceTarget.exists
                    }
                    onClick={() => void initializeWorkspace()}
                  >
                    创建新工作区
                  </button>
                </section>
                <section className="panel">
                  <PanelTitle
                    step="2"
                    title="打开已有工作区"
                    hint="只打开已经初始化完成的 AIGC-Proof 工作区"
                  />
                  <Field label="已有工作区文件夹">
                    <div className="field-row">
                      <input
                        aria-label="已有工作区文件夹"
                        data-testid="open-workspace-path"
                        readOnly
                        placeholder="请选择已有工作区"
                        value={openWorkspacePath}
                        onChange={(e) => setOpenWorkspacePath(e.target.value)}
                      />
                      <button
                        className="secondary"
                        data-testid="choose-open-workspace"
                        onClick={() =>
                          void choose(
                            setOpenWorkspacePath,
                            window.aigcProof.chooseExistingWorkspace,
                          )
                        }
                      >
                        选择已有工作区
                      </button>
                    </div>
                  </Field>
                  <div className="actions">
                    <button
                      className="secondary"
                      data-testid="open-workspace"
                      disabled={!!busy || !openWorkspacePath}
                      onClick={() => void openWorkspace()}
                    >
                      打开所选工作区
                    </button>
                  </div>
                </section>
                <section className="panel">
                  <PanelTitle
                    step="3"
                    title="添加资产"
                    hint="流式复制并计算 SHA-256"
                  />
                  <Field label="资产文件">
                    <div className="field-row">
                      <input
                        data-testid="asset-path"
                        value={assetPath}
                        onChange={(e) => setAssetPath(e.target.value)}
                      />
                      <button
                        className="secondary"
                        onClick={() =>
                          void choose(
                            setAssetPath,
                            window.aigcProof.chooseAsset,
                          )
                        }
                      >
                        选择文件
                      </button>
                    </div>
                  </Field>
                  <Field label="角色">
                    <select
                      data-testid="asset-role"
                      value={assetRole}
                      onChange={(e) =>
                        setAssetRole(e.target.value as AssetRole)
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
                    className="primary"
                    data-testid="add-asset"
                    disabled={!!busy || !workspace}
                    onClick={() => void addAsset()}
                  >
                    添加到工作区
                  </button>
                  <div className="asset-list" data-testid="asset-list">
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
                </section>
              </>
            )}

            {section === "event" && (
              <section className="panel">
                <PanelTitle
                  step="3"
                  title="记录创作事件"
                  hint="JSON 对象将进入规范化事件哈希链"
                />
                <Field label="当前工作区">
                  <input
                    value={workspacePath}
                    onChange={(e) => setWorkspacePath(e.target.value)}
                  />
                </Field>
                <Field label="事件类型">
                  <input
                    data-testid="event-type"
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value)}
                  />
                </Field>
                <Field label="JSON 载荷">
                  <textarea
                    data-testid="event-payload"
                    value={payloadJson}
                    onChange={(e) => setPayloadJson(e.target.value)}
                    rows={12}
                  />
                </Field>
                <button
                  className="primary"
                  data-testid="record-event"
                  disabled={!!busy}
                  onClick={() => void recordEvent()}
                >
                  记录事件
                </button>
              </section>
            )}

            {section === "seal" && (
              <section className="panel">
                <PanelTitle
                  step="4"
                  title="封装 .aigcproof"
                  hint="封装前重新校验工作区，目标文件禁止覆盖"
                />
                <Field label="工作区">
                  <input
                    value={workspacePath}
                    onChange={(e) => setWorkspacePath(e.target.value)}
                  />
                </Field>
                <Field label="输出文件">
                  <div className="field-row">
                    <input
                      data-testid="seal-output"
                      value={sealOutput}
                      onChange={(e) => setSealOutput(e.target.value)}
                    />
                    <button
                      className="secondary"
                      onClick={() =>
                        void choose(
                          setSealOutput,
                          window.aigcProof.choosePackageOutput,
                        )
                      }
                    >
                      选择位置
                    </button>
                  </div>
                </Field>
                <button
                  className="primary"
                  data-testid="seal-package"
                  disabled={!!busy}
                  onClick={() => void sealPackage()}
                >
                  封装并自检
                </button>
              </section>
            )}

            {section === "verify" && (
              <section className="panel">
                <PanelTitle
                  step="5"
                  title="验证或只检查元数据"
                  hint="两种流程互不替代"
                />
                <Field label="证明包">
                  <div className="field-row">
                    <input
                      data-testid="package-path"
                      value={packagePath}
                      onChange={(e) => setPackagePath(e.target.value)}
                    />
                    <button
                      className="secondary"
                      onClick={() =>
                        void choose(
                          setPackagePath,
                          window.aigcProof.choosePackage,
                        )
                      }
                    >
                      选择文件
                    </button>
                  </div>
                </Field>
                <div className="actions">
                  <button
                    className="primary"
                    data-testid="verify-package"
                    disabled={!!busy}
                    onClick={() => void verifyPackage()}
                  >
                    验证包内完整性
                  </button>
                  <button
                    className="secondary"
                    data-testid="inspect-package"
                    disabled={!!busy}
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
                  </div>
                )}
                <Field label="验证报告保存位置">
                  <div className="field-row">
                    <input
                      data-testid="report-path"
                      value={reportPath}
                      onChange={(e) => setReportPath(e.target.value)}
                    />
                    <button
                      className="secondary"
                      onClick={() =>
                        void choose(
                          setReportPath,
                          window.aigcProof.chooseReportOutput,
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
                  disabled={!!busy || !report}
                  onClick={() => void saveReport()}
                >
                  保存最近验证报告
                </button>
              </section>
            )}

            {section === "settings" && (
              <section className="panel">
                <PanelTitle
                  step="6"
                  title="本地设置"
                  hint="设置只保存在本机 SQLite，不进入证明包"
                />
                <Field label="主题">
                  <select
                    data-testid="theme-setting"
                    value={state?.preferences.theme ?? "light"}
                    onChange={(event) => {
                      document.documentElement.dataset.theme =
                        event.target.value;
                      void window.aigcProof
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
                      const response = await window.aigcProof.rebuildRecents();
                      if (!response.ok) return showFailure(response);
                      setState(response.data);
                      showSuccess(
                        "最近项索引已从可携带文件重建",
                        response.data,
                      );
                    })
                  }
                >
                  重建最近项索引
                </button>
                <p className="privacy-note">
                  删除或损坏此数据库不会改变任何工作区、证明包或验证报告的有效性。
                </p>
              </section>
            )}
          </div>

          <aside className={`result-panel ${resultKind}`} aria-live="polite">
            <div className="result-heading">
              <span className={busy ? "spinner" : "status-dot"} />
              <strong data-testid="result-status">
                {busy ??
                  (resultKind === "error"
                    ? "操作失败"
                    : resultKind === "success"
                      ? "操作完成"
                      : "就绪")}
              </strong>
            </div>
            <pre data-testid="result-text">{result}</pre>
          </aside>
        </div>
      </main>
    </div>
  );
}

function PanelTitle({
  step,
  title,
  hint,
}: {
  step: string;
  title: string;
  hint: string;
}) {
  return (
    <div className="panel-title">
      <span>{step}</span>
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
  items: WorkbenchState["recentWorkspaces"];
  onSelect: (path: string) => void;
}) {
  return (
    <div className="recent-card" data-testid={testId}>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p>暂无记录</p>
      ) : (
        items.map((item) => (
          <button
            key={item.path}
            onClick={() => onSelect(item.path)}
            title={item.path}
          >
            {item.path}
          </button>
        ))
      )}
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
            ? "包内完整性有效"
            : report.status === "invalid"
              ? "包内完整性无效"
              : "验证操作错误"}
        </strong>
        <span>{report.proof_id ?? "无可用证明 ID"}</span>
      </div>
      <ul>
        {report.checks.map((check) => (
          <li key={check.code}>
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
    </div>
  );
}
