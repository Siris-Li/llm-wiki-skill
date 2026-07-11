/**
 * 安全 host 边界：后端默认只绑定 loopback（spec §9 / PRODUCT.md §6.8）。
 *
 * 本地 API 不对局域网或任意网页开放。不安全 HOST 不被信任，统一降级回
 * 127.0.0.1 并告警，避免误配置把会改状态的本地 API 暴露到 0.0.0.0。
 *
 * 抽到独立模块是为了让“loopback-only”可以被路由测试直接覆盖（原本埋在
 * index.ts 启动流程里，无法单测）。
 */

/** 允许绑定的 loopback host 集合。其余地址一律拒绝。 */
export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** host 是否属于 loopback。 */
export function isLoopbackHost(host: string): boolean {
	return LOOPBACK_HOSTS.has(host.trim());
}

/**
 * 把用户/环境配置的 HOST 收敛成安全的 loopback host。
 * 空 -> 127.0.0.1；loopback 原样通过；非 loopback -> 告警并降级回 127.0.0.1。
 */
export function localHostOnly(rawHost: string | undefined): string {
	const host = rawHost?.trim() || "127.0.0.1";
	if (isLoopbackHost(host)) return host;
	console.warn(
		`[llm-wiki-agent/server] ignoring unsafe HOST=${host}; binding to 127.0.0.1`,
	);
	return "127.0.0.1";
}
