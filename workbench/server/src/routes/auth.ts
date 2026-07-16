import { Hono } from "hono";
import {
	AuthConnectionTestBodySchema,
	AuthConnectionTestDataSchema,
	AuthSetBodySchema,
	AuthSetDataSchema,
	AuthStatusDataSchema,
	type AuthStatusData,
} from "@llm-wiki/workbench-contracts";

import { getAuthStatus, setAuthKey, testAuthConnection } from "../auth.js";
import { HttpContractError, parseValidatedBody } from "../http/request.js";
import { jsonOk } from "../http/response.js";

export interface AuthRouteService {
	getAuthStatus: () => Promise<unknown>;
	setAuthKey: (provider: string, key: string) => Promise<void>;
	testAuthConnection: (
		provider: string,
	) => Promise<{ ok: boolean; message?: string; error?: string }>;
}

export const defaultAuthRouteService: AuthRouteService = {
	getAuthStatus,
	setAuthKey,
	testAuthConnection,
};

export function createAuthRoutes(service: AuthRouteService): Hono {
	const router = new Hono();

	router.get("/status", async (c) => {
		const status: AuthStatusData = AuthStatusDataSchema.parse(await service.getAuthStatus());
		return jsonOk(c, status);
	});

	router.post("/set", async (c) => {
		const { provider, key } = await parseValidatedBody(c, AuthSetBodySchema);
		try {
			await service.setAuthKey(provider, key);
		} catch (err) {
			throw mapAuthWriteError(err);
		}
		return jsonOk(c, AuthSetDataSchema.parse({ saved: true }));
	});

	router.post("/test", async (c) => {
		const { provider } = await parseValidatedBody(c, AuthConnectionTestBodySchema);
		try {
			const result = await service.testAuthConnection(provider);
			if (!result.ok) {
				throw new HttpContractError(
					"AUTHENTICATION_FAILED",
					"认证连接失败，请检查 API key 后重试",
				);
			}
			return jsonOk(
				c,
				AuthConnectionTestDataSchema.parse({
					message: result.message ?? "连接成功，模型可用",
				}),
			);
		} catch (err) {
			throw mapAuthTestError(err);
		}
	});

	return router;
}

function mapAuthWriteError(err: unknown): HttpContractError {
	if (err instanceof HttpContractError) return err;
	return new HttpContractError("INTERNAL_ERROR", "服务器内部错误");
}

function mapAuthTestError(err: unknown): HttpContractError {
	if (err instanceof HttpContractError) return err;
	const code = (err as { code?: unknown })?.code;
	if (code === "ENOTSUP" || code === "UNSUPPORTED_PLATFORM") {
		return new HttpContractError(
			"UNSUPPORTED_PLATFORM",
			"当前平台不支持认证连接测试",
		);
	}
	return mapAuthWriteError(err);
}
