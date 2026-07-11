/**
 * 本地 capability token（spec §9 / PRODUCT.md §6.8 运行时信任边界）。
 *
 * 每次 server 启动生成一个随机 token，作为本地 API 的能力凭证：所有会读写
 * 文件、改配置、触发模型、启动 SSE、取消任务的 endpoint 必须带这个 token
 * 才放行（见 ./middleware.ts）。
 *
 * token 是本次进程的运行期秘密，红线（spec §9）：
 *   - 不进 URL、不进日志、不进仓库、不进 config.json。
 *   - 只写一份临时运行期文件（~/.llm-wiki-agent/runtime/capability-token，
 *     权限 0600），供同机可信 dev 代理 / 未来桌面壳读取后注入到请求头；下次
 *     启动覆盖。它与 config.json 分开，不是“永久 config”。
 *
 * token 的交付路径（dev）：Vite dev 代理读取上面的运行期文件，在转发到后端的
 * /api 请求上注入 CAPABILITY_TOKEN_HEADER。这样 token 永远不进入浏览器上下文
 * （抗 XSS），且不改动任何前端业务调用。桌面安装版由桌面壳原生注入同一请求头。
 */

import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { CAPABILITY_TOKEN_HEADER } from "@llm-wiki/workbench-contracts";

import { APP_DIR } from "../config.js";

export { CAPABILITY_TOKEN_HEADER };

/**
 * 运行期 token 文件路径。同机可信客户端据此读取本次启动的 token。
 * 注意：与 config.json 完全分开，只存本次进程秘密。
 */
export const CAPABILITY_TOKEN_FILE = join(APP_DIR, "runtime", "capability-token");

/** 生成 256-bit URL-safe 随机 token，足够抵抗穷举。 */
export function generateCapabilityToken(): string {
	return randomBytes(32).toString("base64url");
}

/**
 * 把本次启动的 token 原子写入运行期文件（权限 0600）。
 * 原子写（先 .tmp 再 rename）避免可信客户端读到半截内容。
 */
export async function writeCapabilityToken(token: string): Promise<void> {
	await mkdir(dirname(CAPABILITY_TOKEN_FILE), { recursive: true, mode: 0o700 });
	const tmp = `${CAPABILITY_TOKEN_FILE}.tmp`;
	await writeFile(tmp, token, { mode: 0o600 });
	await rename(tmp, CAPABILITY_TOKEN_FILE);
}
