import { Hono } from "hono";
import { AuthStatusDataSchema, type AuthStatusData } from "@llm-wiki/workbench-contracts";

import { getAuthStatus } from "../auth.js";
import { jsonOk } from "../http/response.js";

export interface AuthRouteService {
	getAuthStatus: () => Promise<unknown>;
}

export const defaultAuthRouteService: AuthRouteService = {
	getAuthStatus,
};

export function createAuthRoutes(service: AuthRouteService): Hono {
	const router = new Hono();

	router.get("/status", async (c) => {
		const status: AuthStatusData = AuthStatusDataSchema.parse(await service.getAuthStatus());
		return jsonOk(c, status);
	});

	return router;
}
