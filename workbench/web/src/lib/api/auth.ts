import {
	AuthConnectionTestDataSchema,
	AuthSetDataSchema,
	AuthStatusDataSchema,
	type AuthConnectionTestData,
	type AuthSetData,
	type AuthStatusData,
} from "@llm-wiki/workbench-contracts";

import { request } from "./client";

export function getAuthStatus(): Promise<AuthStatusData> {
	return request(
		{ method: "GET", path: "/api/auth/status" },
		{ responseSchema: AuthStatusDataSchema },
	);
}

export function setAuthKey(provider: string, key: string): Promise<AuthSetData> {
	return request(
		{ method: "POST", path: "/api/auth/set" },
		{
			body: { provider, type: "api_key", key },
			responseSchema: AuthSetDataSchema,
		},
	);
}

export function testAuthConnection(provider: string): Promise<AuthConnectionTestData> {
	return request(
		{ method: "POST", path: "/api/auth/test" },
		{
			body: { provider },
			responseSchema: AuthConnectionTestDataSchema,
		},
	);
}
