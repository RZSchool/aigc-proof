AIGC-Proof Workbench 0.6.0 Preview
==================================

运行平台
--------
Windows x64。双击 AIGC-Proof.exe 即可启动，不需要安装 Node.js、Rust、npm、Cargo、
数据库、开发服务器或其他开发工具。证明功能可直接使用；本地生成需要用户自行管理、
明确授权的 ComfyUI v0.27.0 portable 安装及至少一个已有 checkpoint。

协议与能力边界
--------------
本工作台使用公开 Rust proof-core / proof-schema 处理签名的 AIGC-Proof 0.3.0，并兼容
未签名的 0.2.0。它验证证明包内部 Manifest、资产摘要和事件哈希链是否自洽，验证
Ed25519 创建者签名，并可在证明包完整有效后核对一个 PNG、JPEG 或 WebP 文件是否与
包内声明为 output 的资产字节完全一致。

创建者身份：显示名称是签名者自我声明，未经过实名或外部身份验证
数字签名：Ed25519 COSE_Sign1；有效性、本地信任和内部完整性分别报告
可信时间：不存在
原创性：未评估

它不是版权登记、公证、作者身份认证、权属证明、原创认证或官方验证。

隐私与本地状态
--------------
程序不使用云服务，不上传文件，不包含账号、遥测、云 API、远程字体或 CDN 运行时。
生成适配器只连接本机 127.0.0.1:8188，不接受远程地址、凭据或重定向。
工作区、资产、事件、报告和 .aigcproof 包都是可携带文件。SQLite 只保存本机偏好、
最近项和 UI 状态；删除数据库不会改变证明文件的有效性。

安全行为
--------
renderer 无 Node.js、文件系统、SQLite、Utility 或原生模块访问。preload 只暴露固定
typed API；Electron Main 负责授权、SQLite 和有界任务调度，受监督 Utility Process 是
唯一加载 napi-rs Rust addon 的进程。证明包和报告均拒绝静默覆盖。正常启动不会开启
DevTools 或远程调试端口，应用也不显示 Electron 菜单栏。

Workbench 0.6.0 使用 ProofHostApi 1.5.0 / native API 1.4.0，并在开放证明操作前核对 engine、
protocol 0.3.0 及 0.2.0 兼容性、能力、执行事实和运行上限。界面显示的路径仅用于辨认，真正路径权限由
Main 内的 opaque 引用持有。任务按一项运行、最多十六项排队；排队任务可取消，已进入
原子 Rust 操作的任务只能如实标为 cancel_requested。Utility 异常会使当前任务失败且
不重放，后续任务使用新的兼容 Utility。当前没有 AIGCStudio 接入、外部身份认证、可信时间、
C2PA、Rights Protection、官方服务、云网络、上传或安全中断运行中原子 Rust 操作的能力。

本地创作
--------
在单页“本地创作 → 自动证明”区域选择 ComfyUI portable 根目录。程序固定核验
python_embeded/python.exe、ComfyUI/main.py、v0.27.0 版本、GPL-3.0 LICENSE、loopback API、
核心节点和 checkpoint 列表。程序不会安装、更新、复制或打包 ComfyUI、Python、GPU
运行时、自定义节点或模型。

Renderer 只能填写 checkpoint 观察值、prompt、negative prompt、seed、尺寸、steps、CFG
以及固定枚举的 sampler/scheduler，不能提交任意 workflow、URL、路径或命令。冻结快照后，
Main 运行仓库自带的固定核心节点模板，自动获取并验证生成图片、加入当前工作区、写入创作
证据事件，然后封装、立即验证并保存报告。成功结果会显示有界缩略图、文件名、大小和
SHA-256；“保存生成图片副本”从已重新校验的 workspace output 导出且永不覆盖已有文件。
导出后可直接在“验证我的图片”中与创作证明包核对。选择 digest-only 时 prompt 原文不写入 SQLite 或
证据，重启后也不能恢复尚未运行的原文。

如果连接的是用户自己启动的共享 ComfyUI，取消只停止 AIGC-Proof 的结果接入和证明发布，
不会发送可能影响其他队列任务的全局 interrupt；本应用自行启动并管理的独立子进程才允许
全局中断。失败或取消不会生成成功输出证明。

工作区创建
----------
“新建工作区”先选择一个已存在的父文件夹，再输入尚不存在的新文件夹名；程序会在
创建前显示完整目标路径。若目标已经存在，程序不会修改它，请改用“打开已有工作区”
或选择其他名称。新建和打开是两个独立流程。

单页操作
--------
所有流程都在同一可滚动页面：验证图片与证明包、工作区、本地创作与自动证明、手动事件、
封装、验证/元数据检查/报告、任务历史与诊断。五种角色的手动资产导入保留在默认折叠的
“高级：手动导入证明素材”；把图片标为 input 只说明它是输入素材，不会把它证明为生成结果。
后续步骤不会被菜单或标签页隐藏；条件不足时会显示前置提示。

已知限制
--------
- 证明包支持 0.3.0 创建者签名，但应用 EXE 尚无发布者代码签名，Windows 可能显示未知发布者提示。
- 大文件操作在隔离 Utility 中执行并显示阶段进度；当前核心操作不支持安全中途取消。
- ComfyUI/provider/model/version/time 均为本机观察值，不代表身份、原创、权属或授权。
- Windows x64 是当前打包平台；macOS 桌面成品尚未测试。
